const payload = {
    "moreCharacteristics": {
        "lift": true,
        "constructedArea": 275,
        "usableArea": 215
    },
    "basicInfo": {
        "title": "Test Title"
    }
};

const getField = (...keys) => {
    const itemAny = payload;
    for (const key of keys) {
        // Direct access
        if (itemAny[key] !== undefined && itemAny[key] !== null) return itemAny[key];

        // Dot notation support (up to 3 levels: parent.child.subchild)
        if (key.includes('.')) {
            const parts = key.split('.');
            let current = itemAny;
            for (let i = 0; i < parts.length; i++) {
                if (current === undefined || current === null) break;
                current = current[parts[i]];
            }
            if (current !== undefined && current !== null) return current;
        }
    }
    return null;
};

const sizeM2 = Number(getField(
    'size',
    'moreCharacteristics.constructedArea',
    'moreCharacteristics.usableArea',
    'basicInfo.builtArea'
)) || 0;

console.log(`Extracted Size: ${sizeM2}`);
if (sizeM2 === 275) console.log("SUCCESS");
else console.log("FAILURE");
