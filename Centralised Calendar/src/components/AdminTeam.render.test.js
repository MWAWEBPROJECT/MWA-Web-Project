import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import react from '@vitejs/plugin-react';
import { createServer } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('Admin Team renders owner edit controls and a read-only member view', async () => {
  const mocks = {
    name: 'admin-team-render-mocks',
    enforce: 'pre',
    resolveId(source) {
      if (source === '../contexts/AuthContext.jsx') return '\0admin-team-auth-mock';
      if (source === '../services/adminTeamService.js') return '\0admin-team-services-mock';
      if (source === './AdminAccessEditor.jsx') return '\0admin-team-editor-mock';
      return null;
    },
    load(id) {
      if (id === '\0admin-team-auth-mock') {
        return `export const OWNER_EMAIL='admin@muhammadiwelfare.org.au';export function useAuth(){return {isOwner:globalThis.__adminTeamRenderOwner===true}}`;
      }
      if (id === '\0admin-team-services-mock') {
        return 'export const watchAdminTeam=()=>()=>{};export const addAdminEmail=async()=>{};export const removeAdminEmail=async()=>{};export const setAdminModules=async()=>{};';
      }
      if (id === '\0admin-team-editor-mock') return 'export default function AdminAccessEditor(){return null}';
      return null;
    }
  };
  const server = await createServer({
    configFile: false,
    root,
    plugins: [mocks, react()],
    resolve: {
      alias: {
        '@mwa/access': path.resolve(root, '../Website/shared/module-access.js')
      }
    },
    server: { middlewareMode: true },
    appType: 'custom'
  });
  try {
    const { default: TeamTab } = await server.ssrLoadModule('/src/components/AdminTeam.jsx');
    globalThis.__adminTeamRenderOwner = true;
    const ownerMarkup = renderToStaticMarkup(React.createElement(TeamTab, { currentEmail: '', canManage: true }));
    assert.match(ownerMarkup, /Add team member/);
    assert.match(ownerMarkup, /<th>Actions<\/th>/);

    globalThis.__adminTeamRenderOwner = false;
    const readOnlyMarkup = renderToStaticMarkup(React.createElement(TeamTab, { currentEmail: '', canManage: true }));
    assert.doesNotMatch(readOnlyMarkup, /Add team member/);
    assert.doesNotMatch(readOnlyMarkup, /<th>Actions<\/th>/);
  } finally {
    delete globalThis.__adminTeamRenderOwner;
    await server.close();
  }
});
