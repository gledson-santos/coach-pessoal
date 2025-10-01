"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeHexColor = void 0;
const normalizeHexColor = (input) => {
    const value = input.trim();
    const withHash = value.startsWith("#") ? value : `#${value}`;
    if (!/^#[0-9a-fA-F]{6}$/.test(withHash)) {
        throw new Error("color must be a hexadecimal value in the format #RRGGBB");
    }
    return withHash.toLowerCase();
};
exports.normalizeHexColor = normalizeHexColor;
