// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title Hash Driller
/// @notice The whole game, stored on Base. `play()` returns it as one data: URL:
/// paste that into a browser's address bar and it plays, with no server. `html()`
/// returns the page itself. There is no owner: nothing here can be changed or
/// removed, by anyone.
contract HashDriller {
    /// @notice The contracts holding the page, in order. Each one's code is a STOP
    /// byte, so it can never run, then its share of the page.
    address[] public chunks;

    /// @notice The page's size in bytes.
    uint256 public immutable size;

    /// @dev "data:text/html;base64," in front of the page.
    uint256 private constant PREFIX_LENGTH = 22;

    constructor(address[] memory chunks_) {
        uint256 total;
        for (uint256 i; i < chunks_.length; ++i) {
            uint256 n = chunks_[i].code.length;
            require(n > 1 && _startsWithStop(chunks_[i]), "HashDriller: not a chunk");
            total += n - 1;
            chunks.push(chunks_[i]);
        }
        require(total > 0, "HashDriller: no page");
        size = total;
    }

    /// @notice How many contracts the page is spread over.
    function chunkCount() external view returns (uint256) {
        return chunks.length;
    }

    /// @notice The game as one HTML page, with its script, styles and fonts inline.
    function html() public view returns (string memory page) {
        page = new string(size);
        uint256 offset;
        for (uint256 i; i < chunks.length; ++i) {
            address chunk = chunks[i];
            uint256 n = chunk.code.length - 1;
            assembly {
                extcodecopy(chunk, add(add(page, 0x20), offset), 1, n)
            }
            offset += n;
        }
    }

    /// @notice The game as a data: URL. Paste it into a browser's address bar to play.
    function play() external view returns (string memory) {
        return _dataUrl(bytes(html()));
    }

    function _startsWithStop(address chunk) private view returns (bool ok) {
        assembly {
            extcodecopy(chunk, 0, 0, 1)
            ok := iszero(byte(0, mload(0)))
        }
    }

    /// @dev "data:text/html;base64," and `data` in base64, with padding.
    function _dataUrl(bytes memory data) private pure returns (string memory url) {
        bytes memory table = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        uint256 len = data.length;
        url = new string(PREFIX_LENGTH + 4 * ((len + 2) / 3));
        assembly {
            // mload(add(t, i)) holds the table's character i in its lowest byte.
            let t := add(table, 1)
            let out := add(url, 0x20)
            mstore(out, "data:text/html;base64,")
            out := add(out, 22)
            let p := add(data, 0x20)
            // Three bytes make four characters.
            let whole := add(p, mul(div(len, 3), 3))
            for {} lt(p, whole) { p := add(p, 3) } {
                let v := shr(232, mload(p))
                mstore8(out, mload(add(t, and(shr(18, v), 63))))
                mstore8(add(out, 1), mload(add(t, and(shr(12, v), 63))))
                mstore8(add(out, 2), mload(add(t, and(shr(6, v), 63))))
                mstore8(add(out, 3), mload(add(t, and(v, 63))))
                out := add(out, 4)
            }
            // One or two bytes left: two or three characters, padded with "=".
            switch mod(len, 3)
            case 1 {
                let v := shl(16, byte(0, mload(p)))
                mstore8(out, mload(add(t, and(shr(18, v), 63))))
                mstore8(add(out, 1), mload(add(t, and(shr(12, v), 63))))
                mstore8(add(out, 2), 0x3d)
                mstore8(add(out, 3), 0x3d)
            }
            case 2 {
                let v := shl(8, shr(240, mload(p)))
                mstore8(out, mload(add(t, and(shr(18, v), 63))))
                mstore8(add(out, 1), mload(add(t, and(shr(12, v), 63))))
                mstore8(add(out, 2), mload(add(t, and(shr(6, v), 63))))
                mstore8(add(out, 3), 0x3d)
            }
        }
    }
}
