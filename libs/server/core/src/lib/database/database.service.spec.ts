import type { Pool, PoolClient } from 'pg';
import { DatabaseService } from './database.service';

/**
 * The transaction contract is the reason this seam exists, so it is tested
 * directly against a fake pool - no database required.
 */
describe('DatabaseService.transaction', () => {
  let statements: string[];
  let released: number;
  let client: PoolClient;
  let pool: Pool;
  let service: DatabaseService;

  beforeEach(() => {
    statements = [];
    released = 0;

    client = {
      query: jest.fn((sql: string) => {
        statements.push(sql);
        return Promise.resolve({ rows: [], rowCount: 0 });
      }),
      release: jest.fn(() => {
        released += 1;
      }),
    } as unknown as PoolClient;

    pool = {
      connect: jest.fn(() => Promise.resolve(client)),
      query: jest.fn(() => Promise.resolve({ rows: [], rowCount: 0 })),
      end: jest.fn(() => Promise.resolve()),
    } as unknown as Pool;

    service = new DatabaseService(pool);
  });

  it('wraps the callback in BEGIN/COMMIT and returns its value', async () => {
    const result = await service.transaction(async (tx) => {
      await tx.query('select 1');
      return 'done';
    });

    expect(result).toBe('done');
    expect(statements).toEqual(['BEGIN', 'select 1', 'COMMIT']);
  });

  it('rolls back and re-throws when the callback fails', async () => {
    const failure = new Error('domain rule violated');

    await expect(
      service.transaction(async (tx) => {
        await tx.query('insert into t values ($1)', ['a']);
        throw failure;
      }),
    ).rejects.toBe(failure);

    expect(statements).toEqual([
      'BEGIN',
      'insert into t values ($1)',
      'ROLLBACK',
    ]);
  });

  it('releases the connection on both paths', async () => {
    await service.transaction(async () => undefined);
    await service
      .transaction(async () => {
        throw new Error('nope');
      })
      .catch(() => undefined);

    expect(released).toBe(2);
  });

  it('uses a single connection for every statement in the transaction', async () => {
    await service.transaction(async (tx) => {
      await tx.query('select 1');
      await tx.query('select 2');
    });

    // One checkout: the whole point, otherwise the statements would land in
    // separate implicit transactions.
    expect(pool.connect).toHaveBeenCalledTimes(1);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('runs single queries on the pool rather than checking out a connection', async () => {
    await service.query('select 1', [1]);

    expect(pool.query).toHaveBeenCalledWith('select 1', [1]);
    expect(pool.connect).not.toHaveBeenCalled();
  });
});
