import express from 'express';
import {
  createStaffUser,
  deleteStaffUser,
  listStaffUsers,
  renameStaffUser,
  updateStaffUserPassword,
} from '../userService.js';
import { escapeHtml, formatDateTime, layout } from '../views.js';

const router = express.Router();

function redirectWithMessage(res, path, { error, success }) {
  const params = new URLSearchParams();
  if (error) {
    params.set('error', error);
  }
  if (success) {
    params.set('success', success);
  }
  const query = params.toString();
  res.redirect(query ? `${path}?${query}` : path);
}

function csrf(req) {
  return req.csrfField ?? '';
}

router.get('/', (req, res) => {
  const users = listStaffUsers();
  const error = req.query.error ? String(req.query.error) : '';
  const success = req.query.success ? String(req.query.success) : '';

  const rows = users
    .map((user) => {
      const isSelf = Number(user.id) === Number(req.session.staffUser.id);
      return `<tr>
        <td>${escapeHtml(user.username)}${isSelf ? ' <span class="pill">you</span>' : ''}</td>
        <td>${formatDateTime(user.created_at)}</td>
        <td class="actions-cell">
          <details class="action-details">
            <summary class="btn btn-small">Change password</summary>
            <form method="post" action="/staff/users/${user.id}/password" class="stack-form compact-form">
              ${csrf(req)}
              <label>
                New password
                <input type="password" name="password" required minlength="8" autocomplete="new-password">
              </label>
              <button type="submit" class="btn btn-small btn-primary">Save password</button>
            </form>
          </details>
          <details class="action-details">
            <summary class="btn btn-small">Rename</summary>
            <form method="post" action="/staff/users/${user.id}/rename" class="stack-form compact-form">
              ${csrf(req)}
              <label>
                Username
                <input type="text" name="username" required minlength="3" maxlength="32"
                       value="${escapeHtml(user.username)}" autocomplete="username">
              </label>
              <button type="submit" class="btn btn-small btn-primary">Save name</button>
            </form>
          </details>
          ${
            isSelf
              ? ''
              : `<form method="post" action="/staff/users/${user.id}/delete" class="inline-form"
                      onsubmit="return confirm('Delete ${escapeHtml(user.username)}?');">
                   ${csrf(req)}
                   <button type="submit" class="btn btn-small btn-danger">Delete</button>
                 </form>`
          }
        </td>
      </tr>`;
    })
    .join('');

  const body = `
    <section class="toolbar">
      <div>
        <h1>Staff users</h1>
        <p class="muted">Manage who can sign in to the dashboard and reports.</p>
      </div>
    </section>

    ${error ? `<p class="error banner">${escapeHtml(error)}</p>` : ''}
    ${success ? `<p class="success banner">${escapeHtml(success)}</p>` : ''}

    <section class="grid two-col">
      <div class="panel">
        <h2>Add user</h2>
        <form method="post" action="/staff/users" class="stack-form">
          ${csrf(req)}
          <label>
            Username
            <input type="text" name="username" required minlength="3" maxlength="32" autocomplete="off">
          </label>
          <label>
            Password
            <input type="password" name="password" required minlength="8" autocomplete="new-password">
          </label>
          <button type="submit" class="btn btn-primary">Create user</button>
        </form>
      </div>
      <div class="panel">
        <h2>Your account</h2>
        <p class="muted">Signed in as <strong>${escapeHtml(req.session.staffUser.username)}</strong>.</p>
        <details class="action-details">
          <summary class="btn btn-secondary">Change my password</summary>
          <form method="post" action="/staff/users/${req.session.staffUser.id}/password" class="stack-form compact-form">
            ${csrf(req)}
            <label>
              New password
              <input type="password" name="password" required minlength="8" autocomplete="new-password">
            </label>
            <button type="submit" class="btn btn-primary">Update password</button>
          </form>
        </details>
      </div>
    </section>

    <section class="panel">
      <h2>All users (${users.length})</h2>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Username</th><th>Created</th><th>Actions</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="3">No users</td></tr>'}</tbody>
        </table>
      </div>
    </section>`;

  res.type('html').send(
    layout({
      title: 'Staff users',
      body,
      staffUser: req.session.staffUser,
      activeNav: 'users',
      csrfField: req.csrfField,
    }),
  );
});

router.post('/', express.urlencoded({ extended: false }), (req, res) => {
  const result = createStaffUser({
    username: req.body.username,
    password: req.body.password,
  });

  if (!result.ok) {
    redirectWithMessage(res, '/staff/users', { error: result.error });
    return;
  }

  redirectWithMessage(res, '/staff/users', {
    success: `Created user "${result.user.username}".`,
  });
});

router.post('/:id/password', express.urlencoded({ extended: false }), (req, res) => {
  const userId = Number(req.params.id);
  const result = updateStaffUserPassword({ userId, password: req.body.password });

  if (!result.ok) {
    redirectWithMessage(res, '/staff/users', { error: result.error });
    return;
  }

  redirectWithMessage(res, '/staff/users', {
    success: `Password updated for "${result.user.username}".`,
  });
});

router.post('/:id/rename', express.urlencoded({ extended: false }), (req, res) => {
  const userId = Number(req.params.id);
  const result = renameStaffUser({
    userId,
    username: req.body.username,
    currentUserId: req.session.staffUser.id,
  });

  if (!result.ok) {
    redirectWithMessage(res, '/staff/users', { error: result.error });
    return;
  }

  if (result.sessionUpdate) {
    req.session.staffUser = result.sessionUpdate;
  }

  redirectWithMessage(res, '/staff/users', {
    success: `Renamed user to "${result.user.username}".`,
  });
});

router.post('/:id/delete', express.urlencoded({ extended: false }), (req, res) => {
  const userId = Number(req.params.id);
  const result = deleteStaffUser({
    userId,
    currentUserId: req.session.staffUser.id,
  });

  if (!result.ok) {
    redirectWithMessage(res, '/staff/users', { error: result.error });
    return;
  }

  redirectWithMessage(res, '/staff/users', {
    success: `Deleted user "${result.user.username}".`,
  });
});

export default router;
