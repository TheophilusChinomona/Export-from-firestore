/**
 * SQL Exporter
 * 
 * Exports Firestore collections to MS SQL Server compatible SQL files
 */

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { config } from '../config.js';
import { transformDocument, mergeSchemas, sanitizeFileName } from './transformers.js';

// SQL Server reserved words that need quoting
const RESERVED_WORDS = new Set([
    'ADD', 'ALL', 'ALTER', 'AND', 'ANY', 'AS', 'ASC', 'AUTHORIZATION', 'BACKUP',
    'BEGIN', 'BETWEEN', 'BREAK', 'BROWSE', 'BULK', 'BY', 'CASCADE', 'CASE',
    'CHECK', 'CHECKPOINT', 'CLOSE', 'CLUSTERED', 'COALESCE', 'COLLATE', 'COLUMN',
    'COMMIT', 'COMPUTE', 'CONSTRAINT', 'CONTAINS', 'CONTAINSTABLE', 'CONTINUE',
    'CONVERT', 'CREATE', 'CROSS', 'CURRENT', 'CURRENT_DATE', 'CURRENT_TIME',
    'CURRENT_TIMESTAMP', 'CURRENT_USER', 'CURSOR', 'DATABASE', 'DBCC',
    'DEALLOCATE', 'DECLARE', 'DEFAULT', 'DELETE', 'DENY', 'DESC', 'DISK',
    'DISTINCT', 'DISTRIBUTED', 'DOUBLE', 'DROP', 'DUMP', 'ELSE', 'END', 'ERRLVL',
    'ESCAPE', 'EXCEPT', 'EXEC', 'EXECUTE', 'EXISTS', 'EXIT', 'EXTERNAL', 'FETCH',
    'FILE', 'FILLFACTOR', 'FOR', 'FOREIGN', 'FREETEXT', 'FREETEXTTABLE', 'FROM',
    'FULL', 'FUNCTION', 'GOTO', 'GRANT', 'GROUP', 'HAVING', 'HOLDLOCK', 'IDENTITY',
    'IDENTITY_INSERT', 'IDENTITYCOL', 'IF', 'IN', 'INDEX', 'INNER', 'INSERT',
    'INTERSECT', 'INTO', 'IS', 'JOIN', 'KEY', 'KILL', 'LEFT', 'LIKE', 'LINENO',
    'LOAD', 'MERGE', 'NATIONAL', 'NOCHECK', 'NONCLUSTERED', 'NOT', 'NULL',
    'NULLIF', 'OF', 'OFF', 'OFFSETS', 'ON', 'OPEN', 'OPENDATASOURCE', 'OPENQUERY',
    'OPENROWSET', 'OPENXML', 'OPTION', 'OR', 'ORDER', 'OUTER', 'OVER', 'PERCENT',
    'PIVOT', 'PLAN', 'PRECISION', 'PRIMARY', 'PRINT', 'PROC', 'PROCEDURE',
    'PUBLIC', 'RAISERROR', 'READ', 'READTEXT', 'RECONFIGURE', 'REFERENCES',
    'REPLICATION', 'RESTORE', 'RESTRICT', 'RETURN', 'REVERT', 'REVOKE', 'RIGHT',
    'ROLLBACK', 'ROWCOUNT', 'ROWGUIDCOL', 'RULE', 'SAVE', 'SCHEMA', 'SECURITYAUDIT',
    'SELECT', 'SEMANTICKEYPHRASETABLE', 'SEMANTICSIMILARITYDETAILSTABLE',
    'SEMANTICSIMILARITYTABLE', 'SESSION_USER', 'SET', 'SETUSER', 'SHUTDOWN',
    'SOME', 'STATISTICS', 'SYSTEM_USER', 'TABLE', 'TABLESAMPLE', 'TEXTSIZE',
    'THEN', 'TO', 'TOP', 'TRAN', 'TRANSACTION', 'TRIGGER', 'TRUNCATE', 'TRY_CONVERT',
    'TSEQUAL', 'UNION', 'UNIQUE', 'UNPIVOT', 'UPDATE', 'UPDATETEXT', 'USE', 'USER',
    'VALUES', 'VARYING', 'VIEW', 'WAITFOR', 'WHEN', 'WHERE', 'WHILE', 'WITH',
    'WITHIN GROUP', 'WRITETEXT', 'TYPE', 'STATUS', 'NAME', 'VALUE', 'DATA', 'LEVEL',
    'DATE', 'TIME', 'TIMESTAMP', 'YEAR', 'MONTH', 'DAY', 'HOUR', 'MINUTE', 'SECOND',
    'ZONE', 'FIRST', 'LAST', 'NEXT', 'PRIOR', 'ABSOLUTE', 'RELATIVE', 'ACTION'
]);

/**
 * Check if a column name needs quoting
 * Quotes if: reserved word, starts with number, contains special chars
 * @param {string} name 
 * @returns {boolean}
 */
function needsQuoting(name) {
    // Reserved word
    if (RESERVED_WORDS.has(name.toUpperCase())) {
        return true;
    }
    // Starts with a number
    if (/^\d/.test(name)) {
        return true;
    }
    // Contains dots, spaces, or other special characters
    if (/[^a-zA-Z0-9_]/.test(name)) {
        return true;
    }
    return false;
}

/**
 * Quote a column/table name if needed
 * @param {string} name 
 * @returns {string}
 */
function quoteName(name) {
    if (needsQuoting(name)) {
        // Escape any brackets in the name itself
        const escaped = name.replace(/\]/g, ']]');
        return `[${escaped}]`;
    }
    return name;
}

/**
 * Escape a string value for SQL
 * @param {any} value 
 * @returns {string}
 */
function escapeSqlValue(value) {
    if (value === null || value === undefined) {
        return 'NULL';
    }

    if (typeof value === 'number') {
        // Handle special number cases
        if (!Number.isFinite(value)) {
            return 'NULL';
        }
        return String(value);
    }

    if (typeof value === 'boolean') {
        return value ? '1' : '0';
    }

    // Handle objects (already stringified by transformer)
    if (typeof value === 'object') {
        value = JSON.stringify(value);
    }

    // Escape single quotes by doubling them
    const escaped = String(value).replace(/'/g, "''");
    return `N'${escaped}'`;
}

/**
 * Generate CREATE TABLE statement
 * @param {string} tableName 
 * @param {object} schema - Field names to SQL types
 * @returns {string}
 */
function generateCreateTable(tableName, schema) {
    const schemaPrefix = config.sql.schema ? `[${config.sql.schema}].` : '';
    const safeTableName = quoteName(tableName);
    const fullTableName = `${schemaPrefix}${safeTableName}`;

    const columns = Object.entries(schema)
        .map(([field, sqlType]) => `    ${quoteName(field)} ${sqlType}`)
        .join(',\n');

    let sql = '';

    if (config.sql.includeDropTable) {
        sql += `IF OBJECT_ID('${schemaPrefix}${tableName}', 'U') IS NOT NULL\n`;
        sql += `    DROP TABLE ${fullTableName};\nGO\n\n`;
    }

    sql += `CREATE TABLE ${fullTableName} (\n`;
    sql += columns;
    sql += `\n);\nGO\n\n`;

    return sql;
}

/**
 * Generate INSERT statement for a document
 * @param {string} tableName 
 * @param {object} data - Transformed document data
 * @param {string[]} columns - Column order
 * @returns {string}
 */
function generateInsert(tableName, data, columns) {
    const schemaPrefix = config.sql.schema ? `[${config.sql.schema}].` : '';
    const safeTableName = quoteName(tableName);
    const fullTableName = `${schemaPrefix}${safeTableName}`;

    const columnList = columns.map(quoteName).join(', ');
    const valueList = columns.map(col => escapeSqlValue(data[col])).join(', ');

    return `INSERT INTO ${fullTableName} (${columnList}) VALUES (${valueList});`;
}

/**
 * Export a collection to a SQL file
 * @param {string} collectionName - Normalized collection name
 * @param {Array<{id: string, data: object, path: string}>} documents 
 * @param {function} onProgress - Progress callback
 * @returns {string} Path to the created file
 */
export function exportToSql(collectionName, documents, onProgress = console.log) {
    // Ensure output directory exists
    if (!existsSync(config.sqlOutputDir)) {
        mkdirSync(config.sqlOutputDir, { recursive: true });
    }

    // Sanitize collection name for filename
    const safeCollectionName = sanitizeFileName(collectionName);

    // Transform all documents and collect schemas
    const transformedDocs = [];
    const schemas = [];

    for (const doc of documents) {
        const { data, schema } = transformDocument(doc.id, doc.data);
        // Add path column for subcollection tracking
        data._path = doc.path;
        schema._path = 'NVARCHAR(500)';
        transformedDocs.push(data);
        schemas.push(schema);
    }

    // Merge schemas to get the widest types
    const mergedSchema = mergeSchemas(schemas);
    const columns = Object.keys(mergedSchema);

    // Generate SQL
    let sql = `-- Firestore Export: ${collectionName}\n`;
    sql += `-- Exported at: ${new Date().toISOString()}\n`;
    sql += `-- Document count: ${documents.length}\n\n`;

    // Add CREATE TABLE if configured
    if (config.sql.includeCreateTable) {
        sql += generateCreateTable(safeCollectionName, mergedSchema);
    }

    // Add INSERT statements
    sql += `-- Data\n`;
    for (const doc of transformedDocs) {
        sql += generateInsert(safeCollectionName, doc, columns) + '\n';
    }
    sql += 'GO\n';

    // Write file
    const filename = `${safeCollectionName}.sql`;
    const filepath = join(config.sqlOutputDir, filename);

    writeFileSync(filepath, sql, 'utf8');

    if (config.logLevel !== 'quiet') {
        onProgress(`   📄 SQL: ${filename} (${documents.length} rows, ${columns.length} columns)`);
    }

    return filepath;
}

/**
 * Export multiple collections to SQL files
 * @param {Map<string, Array>} collectionsData - Map of collection names to documents
 * @param {function} onProgress - Progress callback
 * @returns {string[]} Array of created file paths
 */
export function exportAllToSql(collectionsData, onProgress = console.log) {
    const files = [];

    for (const [collectionName, documents] of collectionsData) {
        if (documents.length === 0) continue;

        try {
            const filepath = exportToSql(collectionName, documents, onProgress);
            files.push(filepath);
        } catch (error) {
            onProgress(`   ❌ Error exporting ${collectionName} to SQL: ${error.message}`);
            if (!config.continueOnError) {
                throw error;
            }
        }
    }

    return files;
}
