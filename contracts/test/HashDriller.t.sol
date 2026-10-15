// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {HashDriller} from "../HashDriller.sol";
import {Chunks, vm} from "../script/Chunks.sol";

/// @notice Run with `forge test` after `pnpm build`: the game stored on chain must
/// come back exactly as the build made it.
contract HashDrillerTest {
    function test_PlayIsTheBuiltDataUrl() external {
        string memory root = vm.projectRoot();
        bytes memory page = vm.readFileBinary(string.concat(root, "/dist/hash-driller.html"));
        HashDriller game = new HashDriller(Chunks.store(page));
        require(game.chunkCount() == (page.length + Chunks.MAX - 1) / Chunks.MAX, "chunk count");
        require(game.size() == page.length, "size");
        require(keccak256(bytes(game.html())) == keccak256(page), "html");
        string memory url = vm.readFile(string.concat(root, "/dist/data-url.txt"));
        require(keccak256(bytes(game.play())) == keccak256(bytes(url)), "play");
    }

    /// @dev The test vectors of RFC 4648, padding and all.
    function test_Base64() external {
        string[7] memory plain = ["", "f", "fo", "foo", "foob", "fooba", "foobar"];
        string[7] memory coded = ["", "Zg==", "Zm8=", "Zm9v", "Zm9vYg==", "Zm9vYmE=", "Zm9vYmFy"];
        for (uint256 i = 1; i < 7; ++i) {
            HashDriller game = new HashDriller(Chunks.store(bytes(plain[i])));
            require(keccak256(bytes(game.play())) == keccak256(bytes(string.concat("data:text/html;base64,", coded[i]))), coded[i]);
        }
    }

    /// @dev Every byte value, across a chunk's edge.
    function test_AcrossChunks() external {
        bytes memory page = new bytes(Chunks.MAX + 300);
        for (uint256 i; i < page.length; ++i) page[i] = bytes1(uint8(i * 7 + 3));
        HashDriller game = new HashDriller(Chunks.store(page));
        require(game.chunkCount() == 2, "chunk count");
        require(keccak256(bytes(game.html())) == keccak256(page), "html");
    }

    function test_RefusesWhatIsNotAChunk() external {
        address[] memory none = new address[](0);
        try new HashDriller(none) {
            revert("took no page");
        } catch {}
        address[] memory code = new address[](1);
        code[0] = address(this);
        try new HashDriller(code) {
            revert("took a contract as a chunk");
        } catch {}
    }
}
