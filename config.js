/**
 * Configuration for Firestore Export
 */

export const config = {
  // Path to your Firebase service account key JSON file
  serviceAccountPath: './serviceAccountKey.json',

  // Collections to export (empty array = export ALL collections)
  // Example: ['users', 'projects', 'tickets']
  collections: [],

  // Output directories
  outputDir: './output',
  jsonOutputDir: './output/json',
  sqlOutputDir: './output/sql',

  // SQL Server specific settings
  sql: {
    // Schema name for tables (null = no schema prefix)
    schema: 'dbo',
    
    // Whether to include CREATE TABLE statements
    includeCreateTable: true,
    
    // Whether to include DROP TABLE IF EXISTS before CREATE
    includeDropTable: true,
    
    // Maximum NVARCHAR length before using NVARCHAR(MAX)
    maxNvarcharLength: 4000,
  },

  // Batch size for reading documents (to avoid memory issues with large collections)
  batchSize: 500,

  // Whether to continue exporting other collections if one fails
  continueOnError: true,

  // Logging verbosity: 'quiet', 'normal', 'verbose'
  logLevel: 'normal',
};
