import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { count } from 'drizzle-orm';
import { config } from 'dotenv';
import * as schema from './schema';

const { users, projects, projectMembers, items } = schema;

// Load environment variables from .env.local
config({ path: '.env.local' });

async function seed() {
  if (!process.env.DATABASE_URL) {
    console.error('❌ ERROR: DATABASE_URL environment variable is not set');
    console.error('   Please check your .env.local file');
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  const db = drizzle(pool, { schema });

  try {
    console.log('🌱 Starting database seed...\n');

    // Check if database is already seeded
    const [userCount] = await db.select({ count: count() }).from(users);

    if (userCount.count > 0) {
      console.log('✓ Database already contains data. Skipping seed.');
      console.log(`  Found ${userCount.count} users\n`);
      await pool.end();
      process.exit(0);
    }

    // 1. Create users
    console.log('👤 Creating users...');

    // Get admin email from environment or use default
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@example.com';

    const [adminUser] = await db
      .insert(users)
      .values({
        id: crypto.randomUUID(),
        email: adminEmail,
        name: 'Admin User',
        role: 'admin',
        emailVerified: true,
      })
      .returning();

    const [regularUser] = await db
      .insert(users)
      .values({
        id: crypto.randomUUID(),
        email: 'user@example.com',
        name: 'Test User',
        role: 'user',
        emailVerified: true,
      })
      .returning();

    console.log(`  ✓ Created admin user (ID: ${adminUser.id})`);
    console.log(`  ✓ Created regular user (ID: ${regularUser.id})\n`);

    // 2. Create projects
    console.log('📁 Creating projects...');

    const [project] = await db
      .insert(projects)
      .values({
        name: 'Sample Project',
        description: 'A test project for development',
        ownerId: adminUser.id,
      })
      .returning();

    console.log(`  ✓ Created project: ${project.name}`);

    // Add admin as project owner
    await db.insert(projectMembers).values({
      projectId: project.id,
      userId: adminUser.id,
      role: 'owner',
    });

    console.log(`  ✓ Added admin as project owner\n`);

    // 3. Create items
    console.log('📝 Creating items...');

    const itemsToCreate = [
      {
        projectId: project.id,
        title: 'Example Item',
        description: 'Example item for testing',
        status: 'active',
      },
      {
        projectId: project.id,
        title: 'Another Item',
        description: 'Another example',
        status: 'active',
      },
    ];

    const createdItems = await db
      .insert(items)
      .values(itemsToCreate)
      .returning();

    createdItems.forEach(item => {
      console.log(`  ✓ Created item: ${item.title}`);
    });

    console.log('\n✨ Database seeded successfully!\n');
    console.log('📊 Summary:');
    console.log(`  - Users: 2 (1 admin, 1 regular)`);
    console.log(`  - Projects: 1`);
    console.log(`  - Items: ${createdItems.length}`);
    console.log('\n💡 Note: Passwords must be set via Better Auth flows:');
    console.log('   - Use "Forgot Password" to set initial password');
    console.log('   - Or use signup flow (if ALLOW_SELF_SIGNUP=true)');
    console.log('   - Or use Better Auth CLI/API\n');

    await pool.end();
    process.exit(0);
  } catch (error) {
    console.error('❌ Seed failed:', error);
    await pool.end();
    process.exit(1);
  }
}

seed();
