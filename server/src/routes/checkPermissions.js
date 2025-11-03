// Add this to the end of your app.js or create a new route
app.get('/api/check-permissions', async (req, res) => {
  try {
    // Check table permissions
    const tablePermissions = await query(`
      SELECT table_name, privilege_type
      FROM information_schema.table_privileges
      WHERE grantee = $1
      ORDER BY table_name, privilege_type;
    `, [process.env.DB_USER]);
    
    // Check role memberships
    const roleQuery = await query(`
      SELECT r.rolname, r.rolsuper, r.rolinherit,
             r.rolcreaterole, r.rolcreatedb, r.rolcanlogin,
             r.rolreplication, r.rolconnlimit
      FROM pg_catalog.pg_roles r
      WHERE r.rolname = $1;
    `, [process.env.DB_USER]);
    
    // Check schema permissions
    const schemaPermissions = await query(`
      SELECT schema_name, privilege_type
      FROM information_schema.schema_privileges
      WHERE grantee = $1;
    `, [process.env.DB_USER]);
    
    res.json({
      tablePermissions: tablePermissions.rows,
      roleInfo: roleQuery.rows,
      schemaPermissions: schemaPermissions.rows
    });
  } catch (error) {
    console.error('Error checking permissions:', error);
    res.status(500).json({ error: error.message });
  }
});