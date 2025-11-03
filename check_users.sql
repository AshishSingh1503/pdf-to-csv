-- Check existing users and their permissions
SELECT usename, usesuper, usecreatedb FROM pg_user;

-- Check table owners
SELECT schemaname, tablename, tableowner FROM pg_tables WHERE schemaname = 'public';

-- Check current user
SELECT current_user, session_user;