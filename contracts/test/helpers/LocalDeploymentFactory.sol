// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

contract LocalDeploymentFactory {
    event ContractDeployed(address indexed addr, bytes32 salt);

    constructor() {
        require(block.chainid == 31337, "Local chain only");
    }

    function deploy(bytes memory creationCode, bytes32 salt) external returns (address addr) {
        assembly {
            addr := create2(0, add(creationCode, 0x20), mload(creationCode), salt)
        }
        require(addr != address(0), "Deployment failed");
        emit ContractDeployed(addr, salt);
    }
}
