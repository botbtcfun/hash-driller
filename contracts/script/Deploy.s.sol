// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {HashDriller} from "../HashDriller.sol";
import {Chunks, vm} from "./Chunks.sol";

/// @notice Puts the built game on chain: its page in chunks, then the contract that
/// serves it. Build first (`pnpm build`), then, from the project's own wallet:
///
///   forge script contracts/script/Deploy.s.sol --rpc-url <base rpc> --account <keystore> --broadcast --slow
contract Deploy {
    function run() external returns (HashDriller game) {
        bytes memory page = vm.readFileBinary(string.concat(vm.projectRoot(), "/dist/hash-driller.html"));
        vm.startBroadcast();
        game = new HashDriller(Chunks.store(page));
        vm.stopBroadcast();
    }
}
