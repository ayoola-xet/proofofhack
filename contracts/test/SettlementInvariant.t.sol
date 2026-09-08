// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {BountyEscrow} from "../src/BountyEscrow.sol";
import {FailableToken, Vm} from "./Settlement.t.sol";

/// @dev This handler owns only local test tokens. Its model never reads escrow accounting to update balances.
contract SettlementHandler {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 private constant ADMISSION_KEY = 0xA11CE;
    uint256 private constant VERDICT_KEY = 0xB0B;
    uint256 private constant INITIAL_SUPPLY = 1e15;
    address public immutable harnessOwner;
    FailableToken public immutable token;
    BountyEscrow public immutable escrow;
    address[4] public claimants;
    address[4] public refundRecipients;
    uint256[4] public expectedPaid;
    uint256[4] public expectedRefunded;
    uint256 public funded;
    uint256 public paid;
    uint256 public refunded;
    uint256 public donated;
    uint256 private nonce;

    struct Model {
        bytes32 id;
        uint256 reward;
        uint256 recipient;
        uint256 claimant;
        BountyEscrow.State state;
        uint64 submissionDeadline;
        uint64 settlementDeadline;
        uint64 reservedAt;
        uint64 expiresAt;
        bytes32 claimId;
        bytes32 evidence;
    }
    Model[] private models;
    BountyEscrow.AdmissionV1[] private admissions;

    constructor() {
        harnessOwner = msg.sender;
        token = new FailableToken();
        escrow = new BountyEscrow(token);
        require(token.approve(address(escrow), type(uint256).max));
        for (uint256 i; i < 4; i++) {
            claimants[i] = address(uint160(0xCA00 + i));
            refundRecipients[i] = address(uint160(0xFA00 + i));
        }
    }

    function sign(uint256 key, bytes32 digest) private returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    function create(uint256 rewardSeed, uint256 recipientSeed) public {
        if (models.length == 32) return;
        uint256 reward = 1 + rewardSeed % 50e6;
        uint256 recipient = recipientSeed % 4;
        uint64 submission = uint64(vm.getBlockTimestamp() + 3600);
        uint64 settlement = submission + 600;
        BountyEscrow.BountyPolicyV1 memory p = BountyEscrow.BountyPolicyV1({
            settlementChainId: block.chainid,
            escrow: address(escrow),
            organizationId: bytes32(uint256(1)),
            refundRecipient: refundRecipients[recipient],
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
            reward: reward,
            minimumDiscrepancy: 1,
            submissionDeadline: submission,
            settlementDeadline: settlement,
            reservationDurationSeconds: 600,
            organizationNonce: bytes32(++nonce)
        });
        bytes32 id = escrow.createAndFund(p);
        require(id == escrow.policyHash(p), "Creation changed policy");
        models.push(Model(id, reward, recipient, 0, BountyEscrow.State.FUNDED, submission, settlement, 0, 0, 0, 0));
        funded += reward;
    }

    function selected(uint256 seed, BountyEscrow.State state, bool fresh) private view returns (uint256) {
        for (uint256 i; i < models.length; i++) {
            uint256 at = (seed % models.length + i) % models.length;
            Model memory m = models[at];
            uint256 deadline = state == BountyEscrow.State.FUNDED ? m.submissionDeadline - 1 : m.expiresAt;
            if (m.state == state && (!fresh || vm.getBlockTimestamp() <= deadline)) return at;
        }
        return type(uint256).max;
    }

    function reserve(uint256 seed, uint256 claimantSeed) public {
        uint256 at = selected(seed, BountyEscrow.State.FUNDED, true);
        if (at == type(uint256).max) return;
        Model storage m = models[at];
        uint256 claimant = claimantSeed % 4;
        BountyEscrow.AdmissionV1 memory a = BountyEscrow.AdmissionV1({
            bountyId: m.id,
            claimId: keccak256(abi.encode("claim", ++nonce)),
            claimant: claimants[claimant],
            evidenceCommitment: keccak256(abi.encode("evidence", nonce)),
            authorizationNonce: keccak256(abi.encode("admission", nonce)),
            validUntil: uint64(vm.getBlockTimestamp() + 300)
        });
        escrow.reserveClaim(a, sign(ADMISSION_KEY, escrow.admissionDigest(a)));
        admissions.push(a);
        m.state = BountyEscrow.State.RESERVED;
        m.claimant = claimant;
        m.claimId = a.claimId;
        m.evidence = a.evidenceCommitment;
        m.reservedAt = uint64(vm.getBlockTimestamp());
        m.expiresAt = m.reservedAt + 600;
    }

    function assessment(Model memory m, bool qualifies) private view returns (BountyEscrow.AssessmentV1 memory) {
        return BountyEscrow.AssessmentV1({
            bountyId: m.id,
            policyHash: m.id,
            claimId: m.claimId,
            claimant: claimants[m.claimant],
            evidenceCommitment: m.evidence,
            caseNullifier: keccak256(abi.encode("case", m.claimId)),
            reportHash: keccak256(abi.encode("report", m.claimId)),
            adapterCodeHash: bytes32(uint256(5)),
            verifierConfigHash: bytes32(uint256(6)),
            outcome: qualifies ? 1 : 2,
            reward: qualifies ? m.reward : 0,
            assessedAt: uint64(vm.getBlockTimestamp()),
            validUntil: m.expiresAt
        });
    }

    function assess(uint256 seed, bool qualifies) public {
        uint256 at = selected(seed, BountyEscrow.State.RESERVED, true);
        if (at == type(uint256).max) return;
        Model storage m = models[at];
        BountyEscrow.AssessmentV1 memory a = assessment(m, qualifies);
        escrow.submitAssessment(a, sign(VERDICT_KEY, escrow.assessmentDigest(a)));
        m.state = qualifies ? BountyEscrow.State.QUALIFIED : BountyEscrow.State.FUNDED;
        if (!qualifies) clearReservation(m);
    }

    function badAssessment(uint256 seed, uint256 fieldSeed) public {
        uint256 at = selected(seed, BountyEscrow.State.RESERVED, true);
        if (at == type(uint256).max) return;
        BountyEscrow.AssessmentV1 memory a = assessment(models[at], true);
        uint256 field = fieldSeed % 10;
        if (field == 0) a.policyHash = bytes32(uint256(a.policyHash) ^ 1);
        if (field == 1) a.claimId = bytes32(uint256(a.claimId) ^ 1);
        if (field == 2) a.claimant = address(0xBAD);
        if (field == 3) a.evidenceCommitment = bytes32(uint256(a.evidenceCommitment) ^ 1);
        if (field == 4) a.adapterCodeHash = bytes32(uint256(99));
        if (field == 5) a.verifierConfigHash = bytes32(uint256(99));
        if (field == 6) a.reward++;
        if (field == 7) a.assessedAt = uint64(vm.getBlockTimestamp() + 1);
        if (field == 8) a.validUntil++;
        bytes memory signature = sign(field == 9 ? 0xBAD : VERDICT_KEY, escrow.assessmentDigest(a));
        (bool ok,) = address(escrow).call(abi.encodeCall(escrow.submitAssessment, (a, signature)));
        require(!ok, "Changed assessment accepted");
    }

    function replay(uint256 seed) public {
        if (admissions.length == 0) return;
        BountyEscrow.AdmissionV1 memory a = admissions[seed % admissions.length];
        // Refresh the expiry and signature. A used claim ID and nonce must remain spent.
        a.validUntil = uint64(vm.getBlockTimestamp() + 300);
        bytes memory signature = sign(ADMISSION_KEY, escrow.admissionDigest(a));
        (bool ok,) = address(escrow).call(abi.encodeCall(escrow.reserveClaim, (a, signature)));
        require(!ok, "Admission replay accepted");
    }

    function expire(uint256 seed) public {
        uint256 at = selected(seed, BountyEscrow.State.RESERVED, false);
        if (at == type(uint256).max) return;
        Model storage m = models[at];
        bool eligible = vm.getBlockTimestamp() > m.expiresAt;
        (bool ok,) = address(escrow).call(abi.encodeCall(escrow.expireReservation, (m.id)));
        require(ok == eligible, "Unexpected expiry result");
        if (ok) {
            m.state = BountyEscrow.State.FUNDED;
            clearReservation(m);
        }
    }

    function clearReservation(Model storage m) private {
        m.claimId = 0;
        m.evidence = 0;
        m.reservedAt = 0;
        m.expiresAt = 0;
    }

    function collect(uint256 seed, bool failTransfer) public {
        if (models.length == 0) return;
        uint256 at = selected(seed, BountyEscrow.State.QUALIFIED, false);
        if (at == type(uint256).max) at = seed % models.length;
        Model storage m = models[at];
        bool eligible = m.state == BountyEscrow.State.QUALIFIED && !failTransfer;
        token.setFailing(failTransfer);
        vm.prank(address(0xD00D));
        (bool ok,) = address(escrow).call(abi.encodeCall(escrow.collectPayment, (m.id)));
        token.setFailing(false);
        require(ok == eligible, "Unexpected collection result");
        if (ok) {
            m.state = BountyEscrow.State.PAID;
            paid += m.reward;
            expectedPaid[m.claimant] += m.reward;
        }
    }

    function refund(uint256 seed, bool failTransfer) public {
        if (models.length == 0) return;
        Model storage m = models[seed % models.length];
        bool eligible = (m.state == BountyEscrow.State.FUNDED || m.state == BountyEscrow.State.RESERVED)
            && vm.getBlockTimestamp() > m.settlementDeadline && !failTransfer;
        token.setFailing(failTransfer);
        vm.prank(address(0xD00D));
        (bool ok,) = address(escrow).call(abi.encodeCall(escrow.refundExpired, (m.id)));
        token.setFailing(false);
        require(ok == eligible, "Unexpected refund result");
        if (ok) {
            if (m.state == BountyEscrow.State.RESERVED) clearReservation(m);
            m.state = BountyEscrow.State.REFUNDED;
            refunded += m.reward;
            expectedRefunded[m.recipient] += m.reward;
        }
    }

    function donate(uint256 seed) public {
        uint256 amount = 1 + seed % 10e6;
        require(token.transfer(address(escrow), amount));
        donated += amount;
    }

    function advanceTime(uint256 seed) public {
        vm.warp(vm.getBlockTimestamp() + seed % 1801);
    }

    function assertModel() public view {
        uint256 liabilities;
        for (uint256 i; i < models.length; i++) {
            Model memory m = models[i];
            BountyEscrow.Bounty memory b = escrow.getBounty(m.id);
            require(escrow.policyHash(b.policy) == m.id, "Funded policy changed");
            require(b.state == m.state, "State differs from model");
            uint256 credit = m.state == BountyEscrow.State.QUALIFIED ? m.reward : 0;
            uint256 unallocated =
                m.state == BountyEscrow.State.FUNDED || m.state == BountyEscrow.State.RESERVED ? m.reward : 0;
            require(b.claimantCredit == credit && b.unallocatedReward == unallocated, "Credit differs from model");
            require(
                b.reservation.claimId == m.claimId && b.reservation.evidenceCommitment == m.evidence,
                "Reservation changed"
            );
            require(
                b.reservation.reservedAt == m.reservedAt && b.reservation.expiresAt == m.expiresAt,
                "Reservation time changed"
            );
            if (m.claimId != 0) require(b.reservation.claimant == claimants[m.claimant], "Beneficiary changed");
            if (m.state == BountyEscrow.State.QUALIFIED || m.state == BountyEscrow.State.PAID) {
                require(b.reportHash == keccak256(abi.encode("report", m.claimId)), "Report commitment changed");
            }
            liabilities += credit + unallocated;
        }
        require(liabilities == funded - paid - refunded, "Liabilities differ from transfers");
        require(escrow.totalLiability() == liabilities, "Global liability differs from model");
        require(token.balanceOf(address(escrow)) == liabilities + donated, "Escrow asset conservation failed");
        require(token.balanceOf(address(this)) == INITIAL_SUPPLY - funded - donated, "Funder balance changed");
        for (uint256 i; i < 4; i++) {
            require(token.balanceOf(claimants[i]) == expectedPaid[i], "Claimant received wrong amount");
            require(
                token.balanceOf(refundRecipients[i]) == expectedRefunded[i], "Refund recipient received wrong amount"
            );
        }
        require(token.balanceOf(address(0xD00D)) == 0, "Relayer received funds");
        for (uint256 i; i < admissions.length; i++) {
            require(escrow.usedAdmissionNonces(admissions[i].authorizationNonce), "Admission nonce reset");
            require(escrow.usedClaimIds(admissions[i].claimId), "Claim ID reset");
        }
    }

    function closeAll() external {
        require(msg.sender == harnessOwner);
        uint256 cutoff = vm.getBlockTimestamp();
        for (uint256 i; i < models.length; i++) {
            if (models[i].settlementDeadline >= cutoff) cutoff = models[i].settlementDeadline + 1;
        }
        vm.warp(cutoff);
        for (uint256 i; i < models.length; i++) {
            if (models[i].state == BountyEscrow.State.QUALIFIED) {
                collect(i, false);
            } else if (models[i].state == BountyEscrow.State.FUNDED || models[i].state == BountyEscrow.State.RESERVED) {
                refund(i, false);
            }
        }
        assertModel();
        require(escrow.totalLiability() == 0, "Legitimate funds remain locked");
        require(token.balanceOf(address(escrow)) == donated, "Donation was paid out");
    }
}

contract SettlementInvariantTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    SettlementHandler public handler;

    struct FuzzSelector {
        address addr;
        bytes4[] selectors;
    }

    function setUp() public {
        vm.chainId(31337);
        vm.warp(1_800_000_000);
        handler = new SettlementHandler();
        for (uint256 i; i < 6; i++) {
            handler.create((i + 1) * 1e6, i);
        }
        for (uint256 i; i < 4; i++) {
            handler.reserve(i, i);
        }
        handler.assess(0, true);
        handler.assess(1, false);
    }

    function targetContracts() external view returns (address[] memory targets) {
        targets = new address[](1);
        targets[0] = address(handler);
    }

    function targetSelectors() external view returns (FuzzSelector[] memory targets) {
        bytes4[] memory selectors = new bytes4[](10);
        selectors[0] = handler.create.selector;
        selectors[1] = handler.reserve.selector;
        selectors[2] = handler.assess.selector;
        selectors[3] = handler.badAssessment.selector;
        selectors[4] = handler.replay.selector;
        selectors[5] = handler.expire.selector;
        selectors[6] = handler.collect.selector;
        selectors[7] = handler.refund.selector;
        selectors[8] = handler.donate.selector;
        selectors[9] = handler.advanceTime.selector;
        targets = new FuzzSelector[](1);
        targets[0] = FuzzSelector(address(handler), selectors);
    }

    function invariant_ESC03_06_15_16_ConservationAndBoundBeneficiaries() public view {
        handler.assertModel();
    }

    function afterInvariant() public {
        handler.closeAll();
    }

    function test_ESC15_StatefulHandlerExercisesRecoveryAndRejection() public {
        for (uint256 i; i < 10; i++) {
            handler.badAssessment(2, i);
        }
        handler.collect(0, true);
        handler.assertModel();
        handler.collect(0, false);
        handler.collect(0, false);
        handler.replay(0);
        handler.donate(100);
        handler.expire(2);
        handler.advanceTime(601);
        handler.expire(2);
        handler.reserve(1, 3);
        handler.assess(1, false);
        handler.reserve(1, 2);
        handler.assess(1, true);
        for (uint256 i; i < 4; i++) {
            handler.advanceTime(1800);
        }
        handler.refund(3, true);
        handler.assertModel();
        handler.refund(3, false);
        handler.closeAll();
    }
}
