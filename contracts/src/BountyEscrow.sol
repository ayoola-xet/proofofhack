// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @notice Fixed-reward escrow for signed, controlled fixture assessments.
/// @dev The admission and verdict operators are trusted. There is no administrator withdrawal.
contract BountyEscrow is EIP712, ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum State {
        NONE,
        FUNDED,
        RESERVED,
        QUALIFIED,
        PAID,
        REFUNDED
    }

    struct BountyPolicyV1 {
        uint256 settlementChainId;
        address escrow;
        bytes32 organizationId;
        address refundRecipient;
        uint256 sourceChainId;
        address sourceVault;
        bytes32 sourceBlockHash;
        bytes32 fixtureManifestRoot;
        bytes32 adapterId;
        bytes32 adapterCodeHash;
        bytes32 verifierConfigHash;
        address admissionSigner;
        address verdictSigner;
        bytes32 reportRecipientKeyId;
        address asset;
        uint256 reward;
        uint256 minimumDiscrepancy;
        uint64 submissionDeadline;
        uint64 settlementDeadline;
        uint32 reservationDurationSeconds;
        bytes32 organizationNonce;
    }

    struct AdmissionV1 {
        bytes32 bountyId;
        bytes32 claimId;
        address claimant;
        bytes32 evidenceCommitment;
        bytes32 authorizationNonce;
        uint64 validUntil;
    }

    struct AssessmentV1 {
        bytes32 bountyId;
        bytes32 policyHash;
        bytes32 claimId;
        address claimant;
        bytes32 evidenceCommitment;
        bytes32 caseNullifier;
        bytes32 reportHash;
        bytes32 adapterCodeHash;
        bytes32 verifierConfigHash;
        uint8 outcome;
        uint256 reward;
        uint64 assessedAt;
        uint64 validUntil;
    }

    struct Reservation {
        bytes32 claimId;
        address claimant;
        bytes32 evidenceCommitment;
        uint64 reservedAt;
        uint64 expiresAt;
    }

    struct Bounty {
        BountyPolicyV1 policy;
        Reservation reservation;
        State state;
        uint256 unallocatedReward;
        uint256 claimantCredit;
        bytes32 reportHash;
    }

    bytes32 public constant POLICY_TYPEHASH = keccak256(
        "BountyPolicyV1(uint256 settlementChainId,address escrow,bytes32 organizationId,address refundRecipient,uint256 sourceChainId,address sourceVault,bytes32 sourceBlockHash,bytes32 fixtureManifestRoot,bytes32 adapterId,bytes32 adapterCodeHash,bytes32 verifierConfigHash,address admissionSigner,address verdictSigner,bytes32 reportRecipientKeyId,address asset,uint256 reward,uint256 minimumDiscrepancy,uint64 submissionDeadline,uint64 settlementDeadline,uint32 reservationDurationSeconds,bytes32 organizationNonce)"
    );
    bytes32 public constant ADMISSION_TYPEHASH = keccak256(
        "AdmissionV1(bytes32 bountyId,bytes32 claimId,address claimant,bytes32 evidenceCommitment,bytes32 authorizationNonce,uint64 validUntil)"
    );
    bytes32 public constant ASSESSMENT_TYPEHASH = keccak256(
        "AssessmentV1(bytes32 bountyId,bytes32 policyHash,bytes32 claimId,address claimant,bytes32 evidenceCommitment,bytes32 caseNullifier,bytes32 reportHash,bytes32 adapterCodeHash,bytes32 verifierConfigHash,uint8 outcome,uint256 reward,uint64 assessedAt,uint64 validUntil)"
    );

    IERC20 public immutable asset;
    uint256 public totalLiability;
    mapping(bytes32 => Bounty) private bounties;
    mapping(bytes32 => bool) public usedAdmissionNonces;
    mapping(bytes32 => bool) public usedClaimIds;
    mapping(bytes32 => mapping(bytes32 => bool)) public usedCaseNullifiers;

    error InvalidPolicy();
    error WrongState();
    error InvalidAuthorization();
    error InvalidAssessment();
    error Expired();
    error NotExpired();
    error Duplicate();
    error FundingMismatch();

    event BountyFunded(
        bytes32 indexed bountyId, bytes32 indexed organizationId, uint256 reward, address asset, bytes32 policyHash
    );
    event ClaimReserved(
        bytes32 indexed bountyId,
        bytes32 indexed claimId,
        address claimant,
        bytes32 evidenceCommitment,
        uint64 expiresAt
    );
    event ClaimRejected(bytes32 indexed bountyId, bytes32 indexed claimId);
    event ReservationExpired(bytes32 indexed bountyId, bytes32 indexed claimId);
    event ClaimQualified(
        bytes32 indexed bountyId, bytes32 indexed claimId, address claimant, uint256 reward, bytes32 reportHash
    );
    event Paid(bytes32 indexed bountyId, bytes32 indexed claimId, address claimant, address asset, uint256 amount);
    event BountyRefunded(bytes32 indexed bountyId, address refundRecipient, address asset, uint256 amount);

    constructor(IERC20 asset_) EIP712("ProofOfHack", "1") {
        if (address(asset_) == address(0)) revert InvalidPolicy();
        asset = asset_;
    }

    function policyHash(BountyPolicyV1 memory policy) public pure returns (bytes32) {
        return keccak256(abi.encode(POLICY_TYPEHASH, policy));
    }

    function admissionDigest(AdmissionV1 memory admission) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(ADMISSION_TYPEHASH, admission)));
    }

    function assessmentDigest(AssessmentV1 memory assessment) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(ASSESSMENT_TYPEHASH, assessment)));
    }

    function getBounty(bytes32 id) external view returns (Bounty memory) {
        return bounties[id];
    }

    function createAndFund(BountyPolicyV1 calldata policy) external nonReentrant returns (bytes32 id) {
        if (
            policy.settlementChainId != block.chainid || policy.escrow != address(this)
                || policy.asset != address(asset) || policy.refundRecipient == address(0)
                || policy.admissionSigner == address(0) || policy.verdictSigner == address(0)
                || policy.organizationId == bytes32(0) || policy.organizationNonce == bytes32(0)
                || policy.fixtureManifestRoot == bytes32(0) || policy.reportRecipientKeyId == bytes32(0)
                || policy.adapterId == bytes32(0) || policy.adapterCodeHash == bytes32(0)
                || policy.verifierConfigHash == bytes32(0) || policy.sourceVault == address(0)
                || policy.sourceChainId == 0 || policy.sourceBlockHash == bytes32(0) || policy.reward == 0
                || policy.minimumDiscrepancy == 0 || policy.submissionDeadline <= block.timestamp
                || policy.reservationDurationSeconds < 60 || policy.reservationDurationSeconds > 1800
                || uint256(policy.settlementDeadline)
                    < uint256(policy.submissionDeadline) + policy.reservationDurationSeconds
        ) revert InvalidPolicy();
        id = policyHash(policy);
        if (bounties[id].state != State.NONE) revert Duplicate();
        uint256 beforeBalance = asset.balanceOf(address(this));
        asset.safeTransferFrom(msg.sender, address(this), policy.reward);
        if (asset.balanceOf(address(this)) - beforeBalance != policy.reward) revert FundingMismatch();
        Bounty storage bounty = bounties[id];
        bounty.policy = policy;
        bounty.state = State.FUNDED;
        bounty.unallocatedReward = policy.reward;
        totalLiability += policy.reward;
        emit BountyFunded(id, policy.organizationId, policy.reward, address(asset), id);
    }

    function reserveClaim(AdmissionV1 calldata admission, bytes calldata signature) external {
        Bounty storage bounty = bounties[admission.bountyId];
        if (bounty.state != State.FUNDED) revert WrongState();
        if (block.timestamp >= bounty.policy.submissionDeadline || block.timestamp > admission.validUntil) {
            revert Expired();
        }
        if (usedAdmissionNonces[admission.authorizationNonce] || usedClaimIds[admission.claimId]) revert Duplicate();
        if (
            admission.claimant == address(0) || admission.claimId == bytes32(0)
                || admission.evidenceCommitment == bytes32(0) || admission.authorizationNonce == bytes32(0)
                || ECDSA.recover(admissionDigest(admission), signature) != bounty.policy.admissionSigner
        ) revert InvalidAuthorization();
        usedAdmissionNonces[admission.authorizationNonce] = true;
        usedClaimIds[admission.claimId] = true;
        uint64 expiresAt = uint64(block.timestamp + bounty.policy.reservationDurationSeconds);
        if (expiresAt > bounty.policy.settlementDeadline) expiresAt = bounty.policy.settlementDeadline;
        bounty.reservation = Reservation(
            admission.claimId, admission.claimant, admission.evidenceCommitment, uint64(block.timestamp), expiresAt
        );
        bounty.state = State.RESERVED;
        emit ClaimReserved(
            admission.bountyId, admission.claimId, admission.claimant, admission.evidenceCommitment, expiresAt
        );
    }

    function submitAssessment(AssessmentV1 calldata assessment, bytes calldata signature) external {
        Bounty storage bounty = bounties[assessment.bountyId];
        if (bounty.state != State.RESERVED) revert WrongState();
        Reservation memory reservation = bounty.reservation;
        if (block.timestamp > reservation.expiresAt || block.timestamp > assessment.validUntil) revert Expired();
        if (
            assessment.policyHash != assessment.bountyId || assessment.claimId != reservation.claimId
                || assessment.claimant != reservation.claimant
                || assessment.evidenceCommitment != reservation.evidenceCommitment
                || assessment.adapterCodeHash != bounty.policy.adapterCodeHash
                || assessment.verifierConfigHash != bounty.policy.verifierConfigHash
                || assessment.assessedAt > block.timestamp || assessment.assessedAt < reservation.reservedAt
                || assessment.validUntil > reservation.expiresAt || assessment.validUntil < assessment.assessedAt
                || assessment.caseNullifier == bytes32(0)
                || ECDSA.recover(assessmentDigest(assessment), signature) != bounty.policy.verdictSigner
        ) revert InvalidAssessment();

        if (assessment.outcome == 1) {
            if (
                assessment.reward != bounty.policy.reward || assessment.reportHash == bytes32(0)
                    || usedCaseNullifiers[assessment.bountyId][assessment.caseNullifier]
            ) revert InvalidAssessment();
            usedCaseNullifiers[assessment.bountyId][assessment.caseNullifier] = true;
            bounty.claimantCredit = bounty.unallocatedReward;
            bounty.unallocatedReward = 0;
            bounty.reportHash = assessment.reportHash;
            bounty.state = State.QUALIFIED;
            emit ClaimQualified(
                assessment.bountyId, assessment.claimId, assessment.claimant, assessment.reward, assessment.reportHash
            );
        } else if (assessment.outcome == 2) {
            if (assessment.reward != 0) revert InvalidAssessment();
            bounty.state = State.FUNDED;
            delete bounty.reservation;
            emit ClaimRejected(assessment.bountyId, assessment.claimId);
        } else {
            revert InvalidAssessment();
        }
    }

    function expireReservation(bytes32 id) public {
        Bounty storage bounty = bounties[id];
        if (bounty.state != State.RESERVED) revert WrongState();
        if (block.timestamp <= bounty.reservation.expiresAt) revert NotExpired();
        bytes32 claimId = bounty.reservation.claimId;
        delete bounty.reservation;
        bounty.state = State.FUNDED;
        emit ReservationExpired(id, claimId);
    }

    function collectPayment(bytes32 id) external nonReentrant {
        Bounty storage bounty = bounties[id];
        if (bounty.state != State.QUALIFIED) revert WrongState();
        uint256 amount = bounty.claimantCredit;
        bounty.claimantCredit = 0;
        bounty.state = State.PAID;
        totalLiability -= amount;
        asset.safeTransfer(bounty.reservation.claimant, amount);
        emit Paid(id, bounty.reservation.claimId, bounty.reservation.claimant, address(asset), amount);
    }

    function refundExpired(bytes32 id) external nonReentrant {
        Bounty storage bounty = bounties[id];
        if (block.timestamp <= bounty.policy.settlementDeadline) revert NotExpired();
        if (bounty.state == State.RESERVED) expireReservation(id);
        if (bounty.state != State.FUNDED) revert WrongState();
        uint256 amount = bounty.unallocatedReward;
        bounty.unallocatedReward = 0;
        bounty.state = State.REFUNDED;
        totalLiability -= amount;
        asset.safeTransfer(bounty.policy.refundRecipient, amount);
        emit BountyRefunded(id, bounty.policy.refundRecipient, address(asset), amount);
    }
}
