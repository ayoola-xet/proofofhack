// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @notice Reference vulnerable vault for ProofOfHack's golden-path test system.
/// Deposits are tracked correctly, but the emergency sweep function is missing
/// its owner check, so any caller can drain the vault's entire balance to any
/// address. This is a real, deployed, exploitable instance of one of the most
/// common real-world DeFi bug classes: a privileged function with a missing
/// access-control modifier.
contract VulnerableVault {
    using SafeERC20 for IERC20;

    IERC20 public immutable asset;
    address public owner;
    mapping(address => uint256) public balanceOf;

    event Deposited(address indexed account, uint256 amount);
    event Swept(address indexed to, uint256 amount);

    constructor(address assetAddress) {
        asset = IERC20(assetAddress);
        owner = msg.sender;
    }

    function deposit(uint256 amount) external {
        asset.safeTransferFrom(msg.sender, address(this), amount);
        balanceOf[msg.sender] += amount;
        emit Deposited(msg.sender, amount);
    }

    /// @dev Intended as an owner-only emergency withdrawal. The `msg.sender ==
    /// owner` check was left out, so this is callable by anyone.
    function sweep(address to, uint256 amount) external {
        asset.safeTransfer(to, amount);
        emit Swept(to, amount);
    }
}
