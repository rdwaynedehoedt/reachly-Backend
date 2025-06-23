**Title: Multi-Tenant SaaS Architecture with Scalable Single-Table Design**

---

**Overview** This document explains how to implement a scalable multi-tenant architecture using a single-table database design. It includes key considerations, optimization strategies, and best practices used by real-world SaaS products like Instantly.

---

**1. What is Multi-Tenancy?** Multi-tenancy is a software architecture where a single instance of a software application serves multiple customers (tenants). Each tenant's data is isolated logically, not physically.

**Approaches:**

* **Single Database, Shared Tables (Soft Multi-Tenancy)** – All tenants share the same database and tables, with each row tagged by a `tenant_id` (e.g., `org_id`).
* **Single Database, Separate Schemas** – Each tenant has their own schema.
* **Separate Databases per Tenant (Hard Multi-Tenancy)** – Each tenant gets a dedicated database.

We focus on the **first** approach for scalability and simplicity.

---

**2. Data Model Design**

```sql
-- Example: Leads Table
CREATE TABLE leads (
  id SERIAL PRIMARY KEY,
  org_id UUID NOT NULL,
  email VARCHAR(255) NOT NULL,
  name VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  ...
);
```

* Every table must include `org_id` (or `tenant_id`).
* Foreign keys should also be tenant-scoped.

---

**3. Query Best Practices**

```sql
SELECT * FROM leads WHERE org_id = 'ORG-1234' AND email LIKE '%gmail.com';
```

\*\*Always filter by \*\*\`\` to avoid scanning rows from other tenants.

---

**4. Performance Optimization Strategies**

* **Indexing:** Create composite indexes like `(org_id, email)`.

  ```sql
  CREATE INDEX idx_leads_org_email ON leads(org_id, email);
  ```

* **Partitioning:** Use table partitioning by `org_id` if supported by your DB (e.g., PostgreSQL).

* **Connection Pooling:** Use tools like PgBouncer to manage DB connections.

* **Caching:** Cache heavy reads using Redis with keys like `org:1234:dashboard-data`.

* **Archiving:** Move old/stale data to an archive table or data lake.

---

**5. Scaling Approaches**

* **Horizontal Scaling:** Distribute load across multiple app and DB servers.
* **Read Replicas:** Use read replicas for analytics and heavy read queries.
* **Sharding (Advanced):** If you grow huge, shard by `org_id` across multiple databases.

---

**6. Real-World Examples**

* **Instantly** and similar SaaS platforms use soft multi-tenancy with highly optimized queries.
* **HubSpot** uses sharding with routing layers once data scales.

---

**7. Security & Isolation**

* Always verify `org_id` from JWT/session before running queries.
* Implement row-level security if supported.

---

**8. Monitoring & Maintenance**

* Track slow queries by tenant.
* Monitor table size growth per tenant.
* Rotate archived data regularly.

---

**Conclusion** Single-table multi-tenancy offers simplicity, cost-efficiency, and performance when done right. Index well, scope all queries, cache smartly, and monitor consistently. Sharding and hard multi-tenancy can be future considerations once you hit extreme scale.

---

**References:**

* Martin Fowler’s Multitenancy Patterns
* Azure SaaS Guidelines
* AWS SaaS Multi-Tenant Best Practices
* Citus Data: Scaling Multi-Tenant PostgreSQL
