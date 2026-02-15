const itemAny = {
    "ubication": {
        "title": "Calle De la Danza, 11",
        "latitude": 36.4076632,
        "longitude": -5.2110158,
        "locationId": "0-EU-ES-29-07-001-051-01-003",
        "locationName": "Estepona Golf, Estepona"
    },
    // Other fields omitted for brevity
};

const getField = (...keys) => {
    for (const key of keys) {
        if (itemAny[key] !== undefined && itemAny[key] !== null) return itemAny[key];
        // Support basic dot notation for one level deep (e.g. "basicInfo.title")
        if (key.includes('.')) {
            const parts = key.split('.');
            if (parts.length === 3) {
                const [parent, child, subchild] = parts;
                if (subchild && itemAny[parent]?.[child]?.[subchild] !== undefined) return itemAny[parent][child][subchild];
            }
            if (parts.length === 2) {
                const [parent, child] = parts;
                if (itemAny[parent] && itemAny[parent][child] !== undefined) return itemAny[parent][child];
            }
        }
    }
    return null;
};

const lat = getField('latitude', 'point.lat', 'address.location.latitude', 'ubication.latitude');
const lng = getField('longitude', 'point.lng', 'address.location.longitude', 'ubication.longitude');

console.log('Result:', { lat, lng });
