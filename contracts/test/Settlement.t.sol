// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {BountyEscrow} from "../src/BountyEscrow.sol";
import {FundingBudgetController} from "../src/FundingBudgetController.sol";
import {TestUSDC} from "../src/TestUSDC.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

interface Vm {
    function warp(uint256) external;
    function getBlockTimestamp() external view returns (uint256);
    function chainId(uint256) external;
    function addr(uint256) external returns (address);
    function sign(uint256, bytes32) external returns (uint8, bytes32, bytes32);
    function prank(address) external;
    function expectRevert() external;
    function expectRevert(bytes4) external;
}

contract FailableToken is ERC20 {
    bool public failing;

    constructor() ERC20("Test", "TEST") {
        _mint(msg.sender, 1e15);
    }

    function setFailing(bool value) external {
        failing = value;
    }

    function transfer(address to, uint256 amount) public override returns (bool) {
        require(!failing, "Transfer unavailable");
        return super.transfer(to, amount);
    }
}

contract SettlementTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 private constant ADMISSION_KEY = 0xA11CE;
    uint256 private constant VERDICT_KEY = 0xB0B;
    TestUSDC private token;
    BountyEscrow private escrow;
    address private claimant;
    address private operator;

    function setUp() public {
        vm.chainId(31337);
        vm.warp(1_800_000_000);
        token = new TestUSDC();
        escrow = new BountyEscrow(token);
        claimant = vm.addr(0xCAFE);
        operator = vm.addr(0xD00D);
        token.approve(address(escrow), type(uint256).max);
    }

    function policy(uint256 nonce) internal returns (BountyEscrow.BountyPolicyV1 memory p) {
        p = BountyEscrow.BountyPolicyV1({
            settlementChainId: block.chainid,
            escrow: address(escrow),
            organizationId: bytes32(uint256(1)),
            refundRecipient: address(this),
            sourceChainId: 1,
            sourceVault: address(0x123),
            sourceBlockHash: bytes32(uint256(2)),
            fixtureManifestRoot: bytes32(uint256(3)),
            adapterId: bytes32(uint256(4)),
            adapterCodeHash: bytes32(uint256(5)),
            verifierConfigHash: bytes32(uint256(6)),
            admissionSigner: vm.addr(ADMISSION_KEY),
            verdictSigner: vm.addr(VERDICT_KEY),
            reportRecipientKeyId: bytes32(uint256(7)),
            asset: address(token),
            reward: 25e6,
            minimumDiscrepancy: 1e6,
            submissionDeadline: uint64(vm.getBlockTimestamp() + 1 days),
            settlementDeadline: uint64(vm.getBlockTimestamp() + 1 days + 1800),
            reservationDurationSeconds: 1800,
            organizationNonce: bytes32(nonce)
        });
    }

    function sign(uint256 key, bytes32 digest) internal returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    function admission(bytes32 id, uint256 nonce) internal view returns (BountyEscrow.AdmissionV1 memory) {
        return BountyEscrow.AdmissionV1(
            id,
            bytes32(nonce),
            claimant,
            bytes32(uint256(10)),
            bytes32(nonce + 1000),
            uint64(vm.getBlockTimestamp() + 300)
        );
    }

    function reserve(bytes32 id, uint256 nonce) internal {
        BountyEscrow.AdmissionV1 memory a = admission(id, nonce);
        escrow.reserveClaim(a, sign(ADMISSION_KEY, escrow.admissionDigest(a)));
    }

    function assessment(bytes32 id, uint8 outcome) internal view returns (BountyEscrow.AssessmentV1 memory a) {
        BountyEscrow.Bounty memory b = escrow.getBounty(id);
        a = BountyEscrow.AssessmentV1(
            id,
            id,
            b.reservation.claimId,
            claimant,
            b.reservation.evidenceCommitment,
            bytes32(uint256(20)),
            bytes32(uint256(21)),
            b.policy.adapterCodeHash,
            b.policy.verifierConfigHash,
            outcome,
            outcome == 1 ? b.policy.reward : 0,
            uint64(vm.getBlockTimestamp()),
            b.reservation.expiresAt
        );
    }

    function qualify(bytes32 id) internal {
        BountyEscrow.AssessmentV1 memory a = assessment(id, 1);
        escrow.submitAssessment(a, sign(VERDICT_KEY, escrow.assessmentDigest(a)));
    }

    function test_ESC01_FundingIsAtomic() public {
        BountyEscrow.BountyPolicyV1 memory p = policy(1);
        token.approve(address(escrow), 0);
        vm.expectRevert();
        escrow.createAndFund(p);
        require(escrow.totalLiability() == 0);
        require(escrow.getBounty(escrow.policyHash(p)).state == BountyEscrow.State.NONE);
    }

    function test_ESC02_DuplicateFundingFails() public {
        BountyEscrow.BountyPolicyV1 memory p = policy(1);
        escrow.createAndFund(p);
        vm.expectRevert(BountyEscrow.Duplicate.selector);
        escrow.createAndFund(p);
        require(escrow.totalLiability() == p.reward);
    }

    function test_ESC04_OnlyOneReservation() public {
        bytes32 id = escrow.createAndFund(policy(1));
        reserve(id, 1);
        BountyEscrow.AdmissionV1 memory a = admission(id, 2);
        bytes memory signature = sign(ADMISSION_KEY, escrow.admissionDigest(a));
        vm.expectRevert(BountyEscrow.WrongState.selector);
        escrow.reserveClaim(a, signature);
    }

    function test_ESC05_AdmissionReplayAndDomainBinding() public {
        bytes32 id = escrow.createAndFund(policy(1));
        BountyEscrow.AdmissionV1 memory a = admission(id, 1);
        bytes memory signature = sign(ADMISSION_KEY, escrow.admissionDigest(a));
        vm.chainId(31338);
        vm.expectRevert(BountyEscrow.InvalidAuthorization.selector);
        escrow.reserveClaim(a, signature);
        vm.chainId(31337);
        escrow.reserveClaim(a, signature);
        vm.warp(vm.getBlockTimestamp() + 1801);
        escrow.expireReservation(id);
        a.validUntil = uint64(vm.getBlockTimestamp() + 300);
        signature = sign(ADMISSION_KEY, escrow.admissionDigest(a));
        vm.expectRevert(BountyEscrow.Duplicate.selector);
        escrow.reserveClaim(a, signature);
    }

    function testFuzz_ESC06_AssessmentBindsClaimant(address wrongClaimant) public {
        if (wrongClaimant == claimant) return;
        bytes32 id = escrow.createAndFund(policy(1));
        reserve(id, 1);
        BountyEscrow.AssessmentV1 memory a = assessment(id, 1);
        a.claimant = wrongClaimant;
        bytes memory signature = sign(VERDICT_KEY, escrow.assessmentDigest(a));
        vm.expectRevert(BountyEscrow.InvalidAssessment.selector);
        escrow.submitAssessment(a, signature);
    }

    function test_ESC06_WrongSignerAndEvidenceFail() public {
        bytes32 id = escrow.createAndFund(policy(1));
        reserve(id, 1);
        BountyEscrow.AssessmentV1 memory a = assessment(id, 1);
        bytes memory signature = sign(ADMISSION_KEY, escrow.assessmentDigest(a));
        vm.expectRevert(BountyEscrow.InvalidAssessment.selector);
        escrow.submitAssessment(a, signature);
        a.evidenceCommitment = bytes32(uint256(999));
        signature = sign(VERDICT_KEY, escrow.assessmentDigest(a));
        vm.expectRevert(BountyEscrow.InvalidAssessment.selector);
        escrow.submitAssessment(a, signature);
    }

    function test_ESC07_ExpiryRejectsAssessment() public {
        bytes32 id = escrow.createAndFund(policy(1));
        reserve(id, 1);
        BountyEscrow.AssessmentV1 memory a = assessment(id, 1);
        bytes memory signature = sign(VERDICT_KEY, escrow.assessmentDigest(a));
        vm.warp(vm.getBlockTimestamp() + 1801);
        vm.expectRevert(BountyEscrow.Expired.selector);
        escrow.submitAssessment(a, signature);
        require(escrow.getBounty(id).claimantCredit == 0);
    }

    function test_ESC08_09_10_14_PermissionlessPaymentPersists() public {
        bytes32 id = escrow.createAndFund(policy(1));
        reserve(id, 1);
        qualify(id);
        require(escrow.getBounty(id).claimantCredit == 25e6);
        vm.warp(vm.getBlockTimestamp() + 365 days);
        vm.prank(operator);
        escrow.collectPayment(id);
        require(token.balanceOf(claimant) == 25e6);
        require(token.balanceOf(operator) == 0);
        require(escrow.totalLiability() == 0);
        vm.expectRevert(BountyEscrow.WrongState.selector);
        escrow.collectPayment(id);
    }

    function test_ESC11_TransferFailurePreservesCredit() public {
        FailableToken replacement = new FailableToken();
        escrow = new BountyEscrow(replacement);
        replacement.approve(address(escrow), type(uint256).max);
        BountyEscrow.BountyPolicyV1 memory p = policy(1);
        p.asset = address(replacement);
        bytes32 id = escrow.createAndFund(p);
        reserve(id, 1);
        qualify(id);
        replacement.setFailing(true);
        vm.expectRevert();
        escrow.collectPayment(id);
        require(escrow.getBounty(id).claimantCredit == p.reward);
        require(escrow.totalLiability() == p.reward);
        replacement.setFailing(false);
        escrow.collectPayment(id);
        require(replacement.balanceOf(claimant) == p.reward);
    }

    function test_ESC12_13_RefundCannotTakeCredit() public {
        BountyEscrow.BountyPolicyV1 memory p = policy(1);
        bytes32 id = escrow.createAndFund(p);
        vm.expectRevert(BountyEscrow.NotExpired.selector);
        escrow.refundExpired(id);
        reserve(id, 1);
        qualify(id);
        vm.warp(p.settlementDeadline + 1);
        vm.expectRevert(BountyEscrow.WrongState.selector);
        escrow.refundExpired(id);
        require(escrow.getBounty(id).claimantCredit == p.reward);
    }

    function test_ESC13_RefundAfterReservationExpiry() public {
        BountyEscrow.BountyPolicyV1 memory p = policy(1);
        uint256 start = token.balanceOf(address(this));
        bytes32 id = escrow.createAndFund(p);
        reserve(id, 1);
        vm.warp(p.settlementDeadline + 1);
        vm.prank(operator);
        escrow.refundExpired(id);
        require(token.balanceOf(address(this)) == start);
        require(token.balanceOf(operator) == 0);
        require(escrow.totalLiability() == 0);
    }

    function test_ControlReopensRewardWithoutPayment() public {
        bytes32 id = escrow.createAndFund(policy(1));
        reserve(id, 1);
        BountyEscrow.AssessmentV1 memory a = assessment(id, 2);
        escrow.submitAssessment(a, sign(VERDICT_KEY, escrow.assessmentDigest(a)));
        require(escrow.getBounty(id).state == BountyEscrow.State.FUNDED);
        require(token.balanceOf(claimant) == 0);
        reserve(id, 2);
        qualify(id);
        escrow.collectPayment(id);
        require(token.balanceOf(claimant) == 25e6);
    }

    function testFuzz_ESC15_16_MixedLifecycleLiability(uint256 seed) public {
        uint256 unpaid;
        for (uint256 i = 1; i <= 16; i++) {
            BountyEscrow.BountyPolicyV1 memory p = policy(i);
            bytes32 id = escrow.createAndFund(p);
            unpaid += p.reward;
            uint256 action = uint256(keccak256(abi.encode(seed, i))) % 4;
            if (action == 0) {
                reserve(id, i);
                qualify(id);
                escrow.collectPayment(id);
                unpaid -= p.reward;
            } else if (action == 1) {
                vm.warp(p.settlementDeadline + 1);
                escrow.refundExpired(id);
                unpaid -= p.reward;
            } else if (action == 2) {
                reserve(id, i);
                qualify(id);
            }
            token.transfer(address(escrow), 1);
            require(escrow.totalLiability() == unpaid);
            require(token.balanceOf(address(escrow)) >= unpaid);
        }
    }

    function controller() internal returns (FundingBudgetController c) {
        c = new FundingBudgetController(address(this), operator, bytes32(uint256(1)), escrow);
        c.setLimits(25e6, 50e6, 60);
        c.setEnabled(true);
        token.transfer(address(c), 100e6);
    }

    function approved(FundingBudgetController c, uint256 nonce)
        internal
        returns (BountyEscrow.BountyPolicyV1 memory p)
    {
        p = policy(nonce);
        p.refundRecipient = address(c);
        c.approvePolicy(escrow.policyHash(p), p.reward, p.submissionDeadline);
    }

    function test_AGT02_03_06_DuplicateAndCumulativeLimits() public {
        FundingBudgetController c = controller();
        BountyEscrow.BountyPolicyV1 memory p = approved(c, 1);
        vm.prank(operator);
        c.fundApprovedPolicy(p);
        vm.prank(operator);
        vm.expectRevert(FundingBudgetController.PolicyNotApproved.selector);
        c.fundApprovedPolicy(p);
        p = approved(c, 2);
        vm.warp(vm.getBlockTimestamp() + 60);
        vm.prank(operator);
        c.fundApprovedPolicy(p);
        p = approved(c, 3);
        vm.warp(vm.getBlockTimestamp() + 60);
        vm.prank(operator);
        vm.expectRevert(FundingBudgetController.BudgetLimitReached.selector);
        c.fundApprovedPolicy(p);
        require(c.spentPerDay(vm.getBlockTimestamp() / 86400) == 50e6);
    }

    function test_AGT04_WrongPolicyAndUnapprovedCaller() public {
        FundingBudgetController c = controller();
        BountyEscrow.BountyPolicyV1 memory p = approved(c, 1);
        vm.expectRevert(FundingBudgetController.Forbidden.selector);
        c.fundApprovedPolicy(p);
        p.refundRecipient = operator;
        vm.prank(operator);
        vm.expectRevert(FundingBudgetController.PolicyNotApproved.selector);
        c.fundApprovedPolicy(p);
    }

    function test_AGT05_DisableDoesNotCancelCredit() public {
        FundingBudgetController c = controller();
        BountyEscrow.BountyPolicyV1 memory p = approved(c, 1);
        vm.prank(operator);
        bytes32 id = c.fundApprovedPolicy(p);
        reserve(id, 1);
        qualify(id);
        c.setEnabled(false);
        c.withdrawUnallocated(75e6);
        escrow.collectPayment(id);
        require(token.balanceOf(claimant) == 25e6);
    }

    function test_PolicyEncodingMatchesStaticTuple() public {
        BountyEscrow.BountyPolicyV1 memory p = policy(1);
        bytes memory encoded = abi.encode(
            escrow.POLICY_TYPEHASH(),
            p.settlementChainId,
            p.escrow,
            p.organizationId,
            p.refundRecipient,
            p.sourceChainId,
            p.sourceVault,
            p.sourceBlockHash,
            p.fixtureManifestRoot,
            p.adapterId,
            p.adapterCodeHash,
            p.verifierConfigHash,
            p.admissionSigner,
            p.verdictSigner,
            p.reportRecipientKeyId,
            p.asset,
            p.reward,
            p.minimumDiscrepancy,
            p.submissionDeadline,
            p.settlementDeadline,
            p.reservationDurationSeconds,
            p.organizationNonce
        );
        require(keccak256(encoded) == escrow.policyHash(p));
    }
}
