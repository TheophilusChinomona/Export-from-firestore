/**
 * Firestore to MS SQL Type Transformers
 * 
 * Converts Firestore-specific data types to SQL Server compatible formats
 */

import admin from 'firebase-admin';

/**
 * Check if a value is a Firestore Bytes/Buffer type
 * @param {any} value 
 * @returns {boolean}
 */
function isBytes(value) {
    // Check for Firestore Bytes (has toBase64 method)
    if (value && typeof value.toBase64 === 'function') {
        return true;
    }
    // Check for Node.js Buffer
    if (Buffer.isBuffer(value)) {
        return true;
    }
    // Check for Uint8Array
    if (value instanceof Uint8Array) {
        return true;
    }
    return false;
}

/**
 * Convert bytes to base64 string
 * @param {any} value 
 * @returns {string}
 */
function bytesToBase64(value) {
    // Firestore Bytes
    if (value && typeof value.toBase64 === 'function') {
        return value.toBase64();
    }
    // Node.js Buffer
    if (Buffer.isBuffer(value)) {
        return value.toString('base64');
    }
    // Uint8Array
    if (value instanceof Uint8Array) {
        return Buffer.from(value).toString('base64');
    }
    return '';
}

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

    // Handle Firestore Bytes / Buffer (MUST be before object check)
    if (isBytes(value)) {
        return {
            value: bytesToBase64(value),
            sqlType: 'NVARCHAR(MAX)', // Base64 encoded string
        };
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

    // Handle Numbers (including edge cases)
    if (typeof value === 'number') {
        // Handle Infinity and NaN
        if (!Number.isFinite(value)) {
            return {
                value: null,
                sqlType: 'FLOAT',
            };
        }

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
 * Sanitize a field name for SQL (replace problematic characters)
 * @param {string} fieldName 
 * @returns {string}
 */
export function sanitizeFieldName(fieldName) {
    // Replace dots with underscores, remove other problematic chars
    let sanitized = fieldName
        .replace(/\./g, '_')           // dots -> underscores
        .replace(/[^\w]/g, '_')        // non-word chars -> underscores
        .replace(/^_+|_+$/g, '')       // trim leading/trailing underscores
        .replace(/_+/g, '_');          // collapse multiple underscores

    // If starts with a number, prefix with underscore
    if (/^\d/.test(sanitized)) {
        sanitized = '_' + sanitized;
    }

    // Ensure not empty
    if (!sanitized) {
        sanitized = '_field';
    }

    return sanitized;
}

/**
 * Transform an entire Firestore document to SQL-compatible format
 * @param {string} docId - Document ID
 * @param {object} data - Document data
 * @returns {{ data: object, schema: object, fieldMapping: object }} Transformed data, schema, and field name mapping
 */
export function transformDocument(docId, data) {
    const transformedData = { id: docId };
    const schema = { id: 'NVARCHAR(255)' };
    const fieldMapping = {}; // original -> sanitized

    for (const [field, value] of Object.entries(data)) {
        const sanitizedField = sanitizeFieldName(field);
        const { value: transformedValue, sqlType } = transformValue(value, field);

        // Handle duplicate sanitized names by appending a number
        let finalField = sanitizedField;
        let counter = 1;
        while (transformedData.hasOwnProperty(finalField) && finalField !== 'id') {
            finalField = `${sanitizedField}_${counter}`;
            counter++;
        }

        transformedData[finalField] = transformedValue;
        schema[finalField] = sqlType;
        fieldMapping[field] = finalField;
    }

    return { data: transformedData, schema, fieldMapping };
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

/**
 * Sanitize a collection name for use as a filename
 * @param {string} collectionName 
 * @returns {string}
 */
export function sanitizeFileName(collectionName) {
    // Replace invalid filename characters
    let sanitized = collectionName
        .replace(/[<>:"/\\|?*]/g, '_')  // Invalid filename chars
        .replace(/\s+/g, '_')           // Spaces -> underscores
        .replace(/_+/g, '_')            // Collapse multiple underscores
        .replace(/^_+|_+$/g, '');       // Trim leading/trailing underscores

    // Limit length (Windows max is 255, be safe with 200)
    if (sanitized.length > 200) {
        sanitized = sanitized.substring(0, 200);
    }

    // Ensure not empty
    if (!sanitized) {
        sanitized = 'collection';
    }

    return sanitized;
}
