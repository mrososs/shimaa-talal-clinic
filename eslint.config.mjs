import nx from '@nx/eslint-plugin';

/**
 * Workspace lint configuration.
 *
 * The important part is `@nx/enforce-module-boundaries`: it is what stops the
 * architecture from eroding. Every project carries three orthogonal tags —
 * `type:`, `platform:` and `scope:` — and a project must satisfy *every* rule
 * whose `sourceTag` it matches.
 *
 * See docs/dependency-rules.md for the reasoning behind each rule.
 */
export default [
  ...nx.configs['flat/base'],
  ...nx.configs['flat/typescript'],
  ...nx.configs['flat/javascript'],
  {
    ignores: [
      '**/dist',
      '**/out-tsc',
      '**/vite.config.*.timestamp*',
      '**/vitest.config.*.timestamp*',
      'apps/mobile/android',
      'apps/mobile/ios',
    ],
  },
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx', '**/*.vue'],
    rules: {
      '@nx/enforce-module-boundaries': [
        'error',
        {
          enforceBuildableLibDependency: true,
          allow: ['^.*/eslint(\\.base)?\\.config\\.[cm]?[jt]s$'],
          depConstraints: [
            // ---------------------------------------------------------------
            // platform: which runtime a project belongs to.
            //
            // This is the rule that keeps server code out of browser bundles
            // and browser code out of the API.
            // ---------------------------------------------------------------
            {
              sourceTag: 'platform:mobile',
              onlyDependOnLibsWithTags: [
                'platform:mobile',
                'platform:client',
                'platform:shared',
              ],
              bannedExternalImports: ['@nestjs/*', 'pg'],
            },
            {
              sourceTag: 'platform:dashboard',
              onlyDependOnLibsWithTags: [
                'platform:dashboard',
                'platform:client',
                'platform:shared',
              ],
              // The dashboard is a plain web app; Ionic and Capacitor belong
              // to the mobile shell only.
              bannedExternalImports: [
                '@nestjs/*',
                '@ionic/*',
                '@capacitor/*',
                'pg',
              ],
            },
            {
              sourceTag: 'platform:client',
              onlyDependOnLibsWithTags: ['platform:client', 'platform:shared'],
              // `pg` in a browser bundle would mean a direct database
              // connection from a client. There is no legitimate reason.
              bannedExternalImports: ['@nestjs/*', 'pg'],
            },
            {
              sourceTag: 'platform:server',
              onlyDependOnLibsWithTags: ['platform:server', 'platform:shared'],
              bannedExternalImports: [
                'vue',
                'vue-router',
                '@vue/*',
                '@ionic/*',
                '@capacitor/*',
              ],
            },
            {
              // Shared code may only depend on other shared code, and must stay
              // framework-free. This is what keeps @clinic/contracts pure.
              sourceTag: 'platform:shared',
              onlyDependOnLibsWithTags: ['platform:shared'],
              bannedExternalImports: [
                'vue',
                'vue-router',
                '@vue/*',
                '@ionic/*',
                '@capacitor/*',
                '@nestjs/*',
                '@supabase/*',
                'express',
                'rxjs',
                'pg',
              ],
            },

            // ---------------------------------------------------------------
            // type: which layer a project sits in.
            //
            // Dependencies flow strictly downwards:
            //   app -> workflow -> feature -> data-access -> util -> contract
            // ---------------------------------------------------------------
            {
              sourceTag: 'type:app',
              onlyDependOnLibsWithTags: [
                'type:workflow',
                'type:feature',
                'type:data-access',
                'type:util',
                'type:contract',
              ],
              // Applications compose modules; they do not open database
              // connections. The pool belongs to server-core.
              bannedExternalImports: ['pg'],
            },
            {
              // Cross-domain orchestration sits one layer ABOVE the domains,
              // and it is the only layer that may depend on several of them.
              //
              // This layer has to exist. Tagging the workflows library
              // `type:feature` (as docs/cross-domain-orchestration.md used to
              // say) cannot work: constraints intersect, and the type:feature
              // rule below forbids depending on type:feature - so a workflow
              // could not import a single domain. Widening type:feature instead
              // would let every domain import every other domain, which is the
              // exact failure this file exists to prevent.
              sourceTag: 'type:workflow',
              onlyDependOnLibsWithTags: [
                'type:feature',
                'type:data-access',
                'type:util',
                'type:contract',
              ],
              // Workflows own the transaction, not the connection. They take an
              // `SqlExecutor` from `@clinic/server-core` like every domain does.
              bannedExternalImports: ['pg'],
            },
            {
              // A domain module never depends on another application.
              sourceTag: 'type:feature',
              onlyDependOnLibsWithTags: [
                'type:data-access',
                'type:util',
                'type:contract',
              ],
              // Domain modules take an `SqlExecutor` from `@clinic/server-core`
              // rather than importing `pg`. This is what keeps the process to
              // exactly one connection pool, and what makes a domain method
              // callable inside someone else's transaction.
              bannedExternalImports: ['pg'],
            },
            {
              sourceTag: 'type:data-access',
              onlyDependOnLibsWithTags: [
                'type:data-access',
                'type:util',
                'type:contract',
              ],
            },
            {
              sourceTag: 'type:util',
              onlyDependOnLibsWithTags: ['type:util', 'type:contract'],
            },
            {
              sourceTag: 'type:contract',
              onlyDependOnLibsWithTags: ['type:contract'],
            },

            // ---------------------------------------------------------------
            // scope: which business domain a project belongs to.
            //
            // Domains are islands: they may use shared code, never each other.
            // Applications deliberately carry no scope tag, because composing
            // every domain is exactly their job.
            //
            // Workflows that span domains (check in -> queue -> notify) are
            // NOT solved by relaxing these rules. They belong to the
            // orchestration library, which may depend on many domains while the
            // domains stay unaware of each other. The asymmetry is the point:
            // ONE project may know about many domains, and it is the one whose
            // job that is. See docs/cross-domain-orchestration.md.
            // ---------------------------------------------------------------
            {
              sourceTag: 'scope:booking',
              onlyDependOnLibsWithTags: ['scope:booking', 'scope:shared'],
            },
            {
              sourceTag: 'scope:queue',
              onlyDependOnLibsWithTags: ['scope:queue', 'scope:shared'],
            },
            {
              sourceTag: 'scope:payments',
              onlyDependOnLibsWithTags: ['scope:payments', 'scope:shared'],
            },
            {
              sourceTag: 'scope:patients',
              onlyDependOnLibsWithTags: ['scope:patients', 'scope:shared'],
            },
            {
              sourceTag: 'scope:notifications',
              onlyDependOnLibsWithTags: ['scope:notifications', 'scope:shared'],
            },
            {
              sourceTag: 'scope:shared',
              onlyDependOnLibsWithTags: ['scope:shared'],
            },
            {
              // The only projects allowed to depend on several domains at once.
              // Domains still cannot see each other; orchestration flows one
              // way, and nothing lists scope:orchestration as a permitted
              // dependency - so no domain can ever depend back on it.
              sourceTag: 'scope:orchestration',
              onlyDependOnLibsWithTags: [
                'scope:booking',
                'scope:queue',
                'scope:payments',
                'scope:patients',
                'scope:notifications',
                'scope:shared',
              ],
            },
          ],
        },
      ],
    },
  },
  {
    files: [
      '**/*.ts',
      '**/*.tsx',
      '**/*.cts',
      '**/*.mts',
      '**/*.js',
      '**/*.jsx',
      '**/*.cjs',
      '**/*.mjs',
    ],
    // Override or add rules here
    rules: {},
  },
];
