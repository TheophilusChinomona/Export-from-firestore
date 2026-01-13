#!/usr/bin/env node

/**
 * JSON to SQL Converter
 * 
 * Converts previously exported JSON files to SQL format
 * 
 * Usage:
 *   npm run convert                    # Convert all JSON files in output/json
 *   npm run convert -- --input ./my-json --output ./my-sql
 */

import { program } from 'commander';
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, basename } from 'path';
import { config } from './config.js';

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
    'SELECT', 'SESSION_USER', 'SET', 'SETUSER', 'SHUTDOWN', 'SOME', 'STATISTICS',
    'SYSTEM_USER', 'TABLE', 'TABLESAMPLE', 'TEXTSIZE', 'THEN', 'TO', 'TOP', 'TRAN',
    'TRANSACTION', 'TRIGGER', 'TRUNCATE', 'UNION', 'UNIQUE', 'UNPIVOT', 'UPDATE',
    'UPDATETEXT', 'USE', 'USER', 'VALUES', 'VARYING', 'VIEW', 'WAITFOR', 'WHEN',
    'WHERE', 'WHILE', 'WITH', 'WRITETEXT', 'TYPE', 'STATUS', 'NAME', 'VALUE', 'DATA', 'LEVEL'
]);

// CLI setup
program
    .name('json-to-sql')
    .description('Convert exported JSON files to SQL format')
    .version('1.0.0')
    .option('-i, --input <path>', 'Input directory with JSON files', './output/json')
    .option('-o, --output <path>', 'Output directory for SQL files', './output/sql')
    .option('--no-create-table', 'Skip CREATE TABLE statements')
    .option('--no-drop-table', 'Skip DROP TABLE IF EXISTS statements')
    .parse();

const options = program.opts();

/**
 * Quote a column/table name if it's a reserved word
 */
function quoteName(name) {
    if (RESERVED_WORDS.has(name.toUpperCase()) || /[^a-zA-Z0-9_]/.test(name)) {
        return `[${name}]`;
    }
    return name;
}

/**
 * Escape a string value for SQL
 */
function escapeSqlValue(value) {
    if (value === null || value === undefined) {
        return 'NULL';
    }

    if (typeof value === 'number') {
        return String(value);
    }

    if (typeof value === 'boolean') {
        return value ? '1' : '0';
    }

    if (typeof value === 'object') {
        value = JSON.stringify(value);
    }

    const escaped = String(value).replace(/'/g, "''");
    return `N'${escaped}'`;
}

/**
 * Infer SQL type from a value
 */
function inferSqlType(value) {
    if (value === null || value === undefined) {
        return 'NVARCHAR(MAX)';
    }

    if (typeof value === 'boolean') {
        return 'BIT';
    }

    if (typeof value === 'number') {
        if (Number.isInteger(value)) {
            if (value >= -2147483648 && value <= 2147483647) {
                return 'INT';
            }
            return 'BIGINT';
        }
        return 'FLOAT';
    }

    if (typeof value === 'string') {
        // Check if it looks like a datetime
        if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)) {
            return 'DATETIME2';
        }

        const length = value.length;
        if (length <= 50) return 'NVARCHAR(50)';
        if (length <= 255) return 'NVARCHAR(255)';
        if (length <= 1000) return 'NVARCHAR(1000)';
        if (length <= 4000) return 'NVARCHAR(4000)';
        return 'NVARCHAR(MAX)';
    }

    if (typeof value === 'object') {
        return 'NVARCHAR(MAX)';
    }

    return 'NVARCHAR(MAX)';
}

/**
 * Get the wider of two SQL types
 */
function getWiderType(type1, type2) {
    if (type1 === type2) return type1;
    if (type1 === 'NVARCHAR(MAX)' || type2 === 'NVARCHAR(MAX)') return 'NVARCHAR(MAX)';

    const typeOrder = [
        'BIT', 'INT', 'BIGINT', 'FLOAT',
        'NVARCHAR(50)', 'NVARCHAR(255)', 'NVARCHAR(1000)', 'NVARCHAR(4000)', 'NVARCHAR(MAX)',
        'DATETIME2'
    ];

    const isNumeric1 = ['BIT', 'INT', 'BIGINT', 'FLOAT'].includes(type1);
    const isNumeric2 = ['BIT', 'INT', 'BIGINT', 'FLOAT'].includes(type2);

    if (isNumeric1 !== isNumeric2) {
        return 'NVARCHAR(MAX)';
    }

    const index1 = typeOrder.indexOf(type1);
    const index2 = typeOrder.indexOf(type2);

    return index1 > index2 ? type1 : type2;
}

/**
 * Convert a single JSON file to SQL
 */
function convertJsonToSql(inputPath, outputDir) {
    const filename = basename(inputPath, '.json');
    const content = JSON.parse(readFileSync(inputPath, 'utf8'));

    const documents = content.documents || [];
    if (documents.length === 0) {
        console.log(`   ⚠️  ${filename}: No documents, skipping`);
        return null;
    }

    // Build schema from all documents
    const schema = {};
    for (const doc of documents) {
        for (const [key, value] of Object.entries(doc)) {
            const sqlType = inferSqlType(value);
            if (!schema[key]) {
                schema[key] = sqlType;
            } else {
                schema[key] = getWiderType(schema[key], sqlType);
            }
        }
    }

    const columns = Object.keys(schema);
    const schemaPrefix = config.sql.schema ? `[${config.sql.schema}].` : '';
    const fullTableName = `${schemaPrefix}[${filename}]`;

    // Build SQL
    let sql = `-- Converted from: ${basename(inputPath)}\n`;
    sql += `-- Converted at: ${new Date().toISOString()}\n`;
    sql += `-- Document count: ${documents.length}\n\n`;

    // DROP TABLE
    if (options.dropTable) {
        sql += `IF OBJECT_ID('${schemaPrefix}${filename}', 'U') IS NOT NULL\n`;
        sql += `    DROP TABLE ${fullTableName};\nGO\n\n`;
    }

    // CREATE TABLE
    if (options.createTable) {
        const columnDefs = Object.entries(schema)
            .map(([field, sqlType]) => `    ${quoteName(field)} ${sqlType}`)
            .join(',\n');

        sql += `CREATE TABLE ${fullTableName} (\n${columnDefs}\n);\nGO\n\n`;
    }

    // INSERT statements
    sql += `-- Data\n`;
    for (const doc of documents) {
        const columnList = columns.map(quoteName).join(', ');
        const valueList = columns.map(col => escapeSqlValue(doc[col])).join(', ');
        sql += `INSERT INTO ${fullTableName} (${columnList}) VALUES (${valueList});\n`;
    }
    sql += 'GO\n';

    // Write output
    const outputPath = join(outputDir, `${filename}.sql`);
    writeFileSync(outputPath, sql, 'utf8');

    console.log(`   ✓ ${filename}.sql (${documents.length} rows, ${columns.length} columns)`);
    return outputPath;
}

/**
 * Main function
 */
async function main() {
    console.log('\n🔄 JSON to SQL Converter\n');
    console.log('========================\n');

    // Check input directory
    if (!existsSync(options.input)) {
        console.error(`❌ Input directory not found: ${options.input}`);
        process.exit(1);
    }

    // Create output directory
    if (!existsSync(options.output)) {
        mkdirSync(options.output, { recursive: true });
    }

    // Find JSON files
    const jsonFiles = readdirSync(options.input)
        .filter(f => f.endsWith('.json'))
        .map(f => join(options.input, f));

    if (jsonFiles.length === 0) {
        console.log('⚠️  No JSON files found in:', options.input);
        process.exit(0);
    }

    console.log(`📁 Input: ${options.input}`);
    console.log(`📁 Output: ${options.output}`);
    console.log(`📄 Files: ${jsonFiles.length}\n`);

    // Convert each file
    let converted = 0;
    for (const file of jsonFiles) {
        try {
            const result = convertJsonToSql(file, options.output);
            if (result) converted++;
        } catch (error) {
            console.error(`   ❌ Error converting ${basename(file)}: ${error.message}`);
        }
    }

    console.log(`\n✅ Converted ${converted} files to SQL\n`);
}

main();
