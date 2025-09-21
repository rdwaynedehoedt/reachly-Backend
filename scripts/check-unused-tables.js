/**
 * Script to check unused/empty tables in the live database
 * This connects to your Azure PostgreSQL and analyzes table usage
 */

const { Pool } = require('pg');
require('dotenv').config();

// Database configuration using the same setup as your app
const dbConfig = {
    host: process.env.AZURE_PG_HOST,
    port: process.env.AZURE_PG_PORT || 5432,
    database: process.env.AZURE_PG_DATABASE,
    user: process.env.AZURE_PG_USER,
    password: process.env.AZURE_PG_PASSWORD,
    ssl: process.env.AZURE_PG_SSL === 'true' ? { rejectUnauthorized: false } : false,
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
};

const pool = new Pool(dbConfig);

async function checkUnusedTables() {
    const client = await pool.connect();
    
    try {
        console.log('🔍 Connecting to Azure PostgreSQL database...\n');
        
        // Test connection
        await client.query('SELECT NOW()');
        console.log('✅ Database connection successful!\n');
        
        console.log('📊 ANALYZING DATABASE TABLES\n');
        console.log('=' * 60);
        
        // Get all tables in the public schema
        const tablesQuery = `
            SELECT 
                table_name,
                table_type
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_type = 'BASE TABLE'
            ORDER BY table_name;
        `;
        
        const tablesResult = await client.query(tablesQuery);
        const tables = tablesResult.rows;
        
        console.log(`\n📋 Found ${tables.length} tables in database:\n`);
        
        // Initialize arrays for categorizing tables
        const emptyTables = [];
        const nonEmptyTables = [];
        const tableStats = [];
        
        // Check each table for data
        for (const table of tables) {
            try {
                const tableName = table.table_name;
                
                // Get row count
                const countQuery = `SELECT COUNT(*) as row_count FROM "${tableName}";`;
                const countResult = await client.query(countQuery);
                const rowCount = parseInt(countResult.rows[0].row_count);
                
                // Get table size
                const sizeQuery = `
                    SELECT 
                        pg_size_pretty(pg_total_relation_size('public."${tableName}"')) as table_size,
                        pg_total_relation_size('public."${tableName}"') as size_bytes
                    FROM information_schema.tables 
                    WHERE table_name = $1;
                `;
                const sizeResult = await client.query(sizeQuery, [tableName]);
                const tableSize = sizeResult.rows[0]?.table_size || '0 bytes';
                const sizeBytes = parseInt(sizeResult.rows[0]?.size_bytes || 0);
                
                // Get column count
                const columnsQuery = `
                    SELECT COUNT(*) as column_count
                    FROM information_schema.columns
                    WHERE table_name = $1 AND table_schema = 'public';
                `;
                const columnsResult = await client.query(columnsQuery, [tableName]);
                const columnCount = parseInt(columnsResult.rows[0].column_count);
                
                const tableInfo = {
                    name: tableName,
                    rowCount,
                    size: tableSize,
                    sizeBytes,
                    columns: columnCount
                };
                
                tableStats.push(tableInfo);
                
                if (rowCount === 0) {
                    emptyTables.push(tableInfo);
                } else {
                    nonEmptyTables.push(tableInfo);
                }
                
                // Display status
                const status = rowCount === 0 ? '❌ EMPTY' : '✅ HAS DATA';
                console.log(`${status.padEnd(12)} | ${tableName.padEnd(25)} | ${rowCount.toString().padStart(8)} rows | ${tableSize.padEnd(10)} | ${columnCount} columns`);
                
            } catch (error) {
                console.log(`⚠️  ERROR     | ${table.table_name.padEnd(25)} | Error: ${error.message}`);
            }
        }
        
        // Summary Report
        console.log('\n' + '=' * 80);
        console.log('📈 SUMMARY REPORT');
        console.log('=' * 80);
        
        console.log(`\n📊 OVERALL STATISTICS:`);
        console.log(`   • Total Tables: ${tables.length}`);
        console.log(`   • Tables with Data: ${nonEmptyTables.length} (${((nonEmptyTables.length / tables.length) * 100).toFixed(1)}%)`);
        console.log(`   • Empty Tables: ${emptyTables.length} (${((emptyTables.length / tables.length) * 100).toFixed(1)}%)`);
        
        if (emptyTables.length > 0) {
            console.log(`\n🚨 EMPTY/UNUSED TABLES (${emptyTables.length}):`);
            emptyTables.forEach(table => {
                console.log(`   • ${table.name} (${table.columns} columns, ${table.size})`);
            });
        }
        
        if (nonEmptyTables.length > 0) {
            console.log(`\n✅ TABLES WITH DATA (${nonEmptyTables.length}):`);
            nonEmptyTables
                .sort((a, b) => b.rowCount - a.rowCount)
                .forEach(table => {
                    console.log(`   • ${table.name.padEnd(25)} | ${table.rowCount.toString().padStart(6)} rows | ${table.size}`);
                });
        }
        
        // Recommendations
        console.log(`\n💡 RECOMMENDATIONS:`);
        if (emptyTables.length > 0) {
            console.log(`   • Consider removing ${emptyTables.length} empty tables if they're not needed`);
            console.log(`   • Or populate them with data if they're part of planned features`);
        } else {
            console.log(`   • Great! All tables are being used effectively`);
        }
        
        // Check for tables that might be part of incomplete features
        const possiblyUnfinishedFeatures = emptyTables.filter(table => 
            table.columns > 3 && table.sizeBytes > 8192 // Tables with structure but no data
        );
        
        if (possiblyUnfinishedFeatures.length > 0) {
            console.log(`\n🔄 POSSIBLY UNFINISHED FEATURES:`);
            possiblyUnfinishedFeatures.forEach(table => {
                console.log(`   • ${table.name} - Has ${table.columns} columns but no data (might be a planned feature)`);
            });
        }
        
        console.log('\n' + '=' * 80);
        console.log('✅ Database analysis complete!');
        console.log('=' * 80);
        
    } catch (error) {
        console.error('❌ Error analyzing database:', error);
        console.error('Stack trace:', error.stack);
    } finally {
        client.release();
        await pool.end();
    }
}

// Run the analysis
if (require.main === module) {
    console.log('🚀 Starting Database Table Analysis...\n');
    checkUnusedTables()
        .then(() => {
            console.log('\n🎉 Analysis completed successfully!');
            process.exit(0);
        })
        .catch((error) => {
            console.error('\n💥 Analysis failed:', error.message);
            process.exit(1);
        });
}

module.exports = { checkUnusedTables };


