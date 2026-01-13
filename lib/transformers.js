/**
 * Firestore to MS SQL Type Transformers
 * 
 * Converts Firestore-specific data types to SQL Server compatible formats
 */

import admin from 'firebase-admin';

/**
 * Transform a Firestore value to a SQL-compatible value
 * @param {any} value - The Firestore value
 * @param {string} fieldName - Name of the field (for context)
 * @returns {{ value: any, sqlType: string }} Transformed value and inferred SQL type
 */
export function transformValue(value, fieldName = '') {
    // Handle null/undefined
    if (value === null || value === undefined) {
        return { value: null, sqlType: 'NVARCHAR(MAX)' };
    }

    // Handle Firestore Timestamp
    if (value instanceof admin.firestore.Timestamp) {
        return {
            value: value.toDate().toISOString(),
            sqlType: 'DATETIME2',
        };
    }

    // Handle JavaScript Date
    if (value instanceof Date) {
        return {
            value: value.toISOString(),
            sqlType: 'DATETIME2',
        };
    }

    // Handle Firestore GeoPoint
    if (value instanceof admin.firestore.GeoPoint) {
        return {
            value: { latitude: value.latitude, longitude: value.longitude },
            sqlType: 'NVARCHAR(100)', // Store as JSON string
        };
    }

    // Handle Firestore DocumentReference
    if (value instanceof admin.firestore.DocumentReference) {
        return {
            value: value.path,
            sqlType: 'NVARCHAR(500)',
        };
    }

    // Handle Arrays
    if (Array.isArray(value)) {
        const transformedArray = value.map((item, index) =>
            transformValue(item, `${fieldName}[${index}]`).value
        );
        return {
            value: JSON.stringify(transformedArray),
            sqlType: 'NVARCHAR(MAX)',
        };
    }

    // Handle Objects (Maps)
    if (typeof value === 'object' && value !== null) {
        const transformedObject = {};
        for (const [key, val] of Object.entries(value)) {
            transformedObject[key] = transformValue(val, `${fieldName}.${key}`).value;
        }
        return {
            value: JSON.stringify(transformedObject),
            sqlType: 'NVARCHAR(MAX)',
        };
    }

    // Handle Booleans
    if (typeof value === 'boolean') {
        return {
            value: value ? 1 : 0,
            sqlType: 'BIT',
        };
    }

    // Handle Numbers
    if (typeof value === 'number') {
        if (Number.isInteger(value)) {
            // Check if it fits in INT range
            if (value >= -2147483648 && value <= 2147483647) {
                return { value, sqlType: 'INT' };
            }
            return { value, sqlType: 'BIGINT' };
        }
        return { value, sqlType: 'FLOAT' };
    }

    // Handle Strings
    if (typeof value === 'string') {
        const length = value.length;
        if (length <= 50) return { value, sqlType: 'NVARCHAR(50)' };
        if (length <= 255) return { value, sqlType: 'NVARCHAR(255)' };
        if (length <= 1000) return { value, sqlType: 'NVARCHAR(1000)' };
        if (length <= 4000) return { value, sqlType: 'NVARCHAR(4000)' };
        return { value, sqlType: 'NVARCHAR(MAX)' };
    }

    // Default fallback
    return {
        value: String(value),
        sqlType: 'NVARCHAR(MAX)',
    };
}

/**
 * Transform an entire Firestore document to SQL-compatible format
 * @param {string} docId - Document ID
 * @param {object} data - Document data
 * @returns {{ data: object, schema: object }} Transformed data and inferred schema
 */
export function transformDocument(docId, data) {
    const transformedData = { id: docId };
    const schema = { id: 'NVARCHAR(255)' };

    for (const [field, value] of Object.entries(data)) {
        const { value: transformedValue, sqlType } = transformValue(value, field);
        transformedData[field] = transformedValue;
        schema[field] = sqlType;
    }

    return { data: transformedData, schema };
}

/**
 * Merge multiple schemas to find the most compatible types
 * @param {object[]} schemas - Array of schema objects
 * @returns {object} Merged schema with widest types
 */
export function mergeSchemas(schemas) {
    const merged = {};

    for (const schema of schemas) {
        for (const [field, sqlType] of Object.entries(schema)) {
            if (!merged[field]) {
                merged[field] = sqlType;
            } else {
                // Use the wider type
                merged[field] = getWiderType(merged[field], sqlType);
            }
        }
    }

    return merged;
}

/**
 * Get the wider (more compatible) of two SQL types
 */
function getWiderType(type1, type2) {
    const typeHierarchy = [
        'BIT',
        'INT',
        'BIGINT',
        'FLOAT',
        'NVARCHAR(50)',
        'NVARCHAR(100)',
        'NVARCHAR(255)',
        'NVARCHAR(500)',
        'NVARCHAR(1000)',
        'NVARCHAR(4000)',
        'NVARCHAR(MAX)',
        'DATETIME2',
    ];

    // Special cases
    if (type1 === type2) return type1;
    if (type1 === 'NVARCHAR(MAX)' || type2 === 'NVARCHAR(MAX)') return 'NVARCHAR(MAX)';

    const index1 = typeHierarchy.indexOf(type1);
    const index2 = typeHierarchy.indexOf(type2);

    // If types are in different categories (numeric vs string), use NVARCHAR(MAX)
    const isNumeric1 = ['BIT', 'INT', 'BIGINT', 'FLOAT'].includes(type1);
    const isNumeric2 = ['BIT', 'INT', 'BIGINT', 'FLOAT'].includes(type2);

    if (isNumeric1 !== isNumeric2) {
        return 'NVARCHAR(MAX)';
    }

    return index1 > index2 ? type1 : type2;
}
