// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Local-only token. The constructor rejects public chain deployments.
contract TestUSDC is ERC20 {
    constructor() ERC20("Local test USDC", "TEST_USDC") {
        require(block.chainid == 31337, "Local chain only");
        _mint(msg.sender, 1_000_000 * 1e6);
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }
}
