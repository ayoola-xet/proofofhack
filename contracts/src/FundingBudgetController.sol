// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {BountyEscrow} from "./BountyEscrow.sol";

/// @notice Funds only exact policies approved by the organization owner.
contract FundingBudgetController is ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Approval {
        uint256 reward;
        uint64 expiresAt;
        bool consumed;
    }
    address public immutable owner;
    address public immutable operator;
    bytes32 public immutable organizationId;
    IERC20 public immutable asset;
    BountyEscrow public immutable escrow;
    bool public enabled;
    uint256 public perActionLimit;
    uint256 public dailyLimit;
    uint256 public minimumInterval;
    uint256 public lastAllocation;
    mapping(uint256 => uint256) public spentPerDay;
    mapping(bytes32 => Approval) public approvals;

    error Forbidden();
    error InvalidConfiguration();
    error PolicyNotApproved();
    error BudgetLimitReached();
    error Disabled();
    event PolicyApproved(address indexed controller, bytes32 indexed policyHash, uint256 reward, uint64 expiresAt);
    event BudgetAllocated(
        address indexed controller, bytes32 indexed policyHash, bytes32 bountyId, uint256 amount, uint256 utcDayBucket
    );
    event BudgetSettingsChanged(
        address indexed controller, bool enabled, uint256 perActionLimit, uint256 dailyLimit, uint256 minimumInterval
    );
    event BudgetWithdrawn(address indexed controller, address recipient, uint256 amount);

    constructor(address owner_, address operator_, bytes32 organizationId_, BountyEscrow escrow_) {
        if (
            owner_ == address(0) || operator_ == address(0) || organizationId_ == bytes32(0)
                || address(escrow_) == address(0)
        ) revert InvalidConfiguration();
        owner = owner_;
        operator = operator_;
        organizationId = organizationId_;
        escrow = escrow_;
        asset = escrow_.asset();
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert Forbidden();
        _;
    }

    function approvePolicy(bytes32 hash, uint256 reward, uint64 expiresAt) external onlyOwner {
        if (hash == bytes32(0) || reward == 0 || expiresAt <= block.timestamp || approvals[hash].consumed) {
            revert InvalidConfiguration();
        }
        approvals[hash] = Approval(reward, expiresAt, false);
        emit PolicyApproved(address(this), hash, reward, expiresAt);
    }

    function setLimits(uint256 perAction, uint256 daily, uint256 interval) external onlyOwner {
        if (perAction == 0 || daily < perAction || interval < 60) revert InvalidConfiguration();
        perActionLimit = perAction;
        dailyLimit = daily;
        minimumInterval = interval;
        emit BudgetSettingsChanged(address(this), enabled, perAction, daily, interval);
    }

    function setEnabled(bool value) external onlyOwner {
        if (value && perActionLimit == 0) revert InvalidConfiguration();
        enabled = value;
        emit BudgetSettingsChanged(address(this), value, perActionLimit, dailyLimit, minimumInterval);
    }

    function fundApprovedPolicy(BountyEscrow.BountyPolicyV1 calldata policy)
        external
        nonReentrant
        returns (bytes32 id)
    {
        if (msg.sender != operator) revert Forbidden();
        if (!enabled) revert Disabled();
        bytes32 hash = escrow.policyHash(policy);
        Approval storage approval = approvals[hash];
        if (
            approval.reward == 0 || approval.consumed || approval.expiresAt <= block.timestamp
                || policy.reward != approval.reward || policy.refundRecipient != address(this)
                || policy.organizationId != organizationId || policy.asset != address(asset)
                || policy.escrow != address(escrow) || policy.settlementChainId != block.chainid
        ) revert PolicyNotApproved();
        uint256 dayBucket = block.timestamp / 86400;
        if (
            policy.reward > perActionLimit || spentPerDay[dayBucket] + policy.reward > dailyLimit
                || (lastAllocation != 0 && block.timestamp < lastAllocation + minimumInterval)
        ) revert BudgetLimitReached();
        approval.consumed = true;
        spentPerDay[dayBucket] += policy.reward;
        lastAllocation = block.timestamp;
        asset.forceApprove(address(escrow), policy.reward);
        id = escrow.createAndFund(policy);
        asset.forceApprove(address(escrow), 0);
        emit BudgetAllocated(address(this), hash, id, policy.reward, dayBucket);
    }

    function withdrawUnallocated(uint256 amount) external onlyOwner nonReentrant {
        asset.safeTransfer(owner, amount);
        emit BudgetWithdrawn(address(this), owner, amount);
    }
}
