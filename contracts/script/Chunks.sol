// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @dev The few Foundry cheatcodes the test and the deploy use, so they need no libraries.
interface Vm {
    function projectRoot() external view returns (string memory);
    function readFile(string calldata path) external view returns (string memory);
    function readFileBinary(string calldata path) external view returns (bytes memory);
    function startBroadcast() external;
    function stopBroadcast() external;
}

Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

/// @notice Stores a page onchain as contract code: one contract per share of it, as
/// much as a contract's code may hold. Each share is deployed behind a STOP byte, so
/// it can never run, and HashDriller reads it back with EXTCODECOPY.
library Chunks {
    /// @dev The most code a contract may have (EIP-170), less the STOP byte.
    uint256 internal constant MAX = 24_575;

    /// @dev Deploys the code after it, the creation code's first 11 bytes, as is.
    bytes internal constant CREATE_PREFIX = hex"600b5981380380925939f3";

    function store(bytes memory page) internal returns (address[] memory chunks) {
        chunks = new address[]((page.length + MAX - 1) / MAX);
        for (uint256 i; i < chunks.length; ++i) {
            uint256 from = i * MAX;
            uint256 n = page.length - from < MAX ? page.length - from : MAX;
            bytes memory part = new bytes(n);
            assembly {
                mcopy(add(part, 0x20), add(add(page, 0x20), from), n)
            }
            bytes memory init = abi.encodePacked(CREATE_PREFIX, hex"00", part);
            address chunk;
            assembly {
                chunk := create(0, add(init, 0x20), mload(init))
            }
            require(chunk != address(0), "Chunks: store failed");
            chunks[i] = chunk;
        }
    }
}
