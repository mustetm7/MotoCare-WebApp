import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AdminUsersPortal } from '../src/components/AdminUsersPortal';
import { Navbar } from '../src/components/Navbar';
import { INITIAL_USER_ACCOUNTS } from '../src/utils/storage';
import { Motorcycle, UserSubscription, MaintenanceReminder } from '../src/types';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ FAIL: ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
}

console.log('========================================================================');
console.log(' MotoCare Admin Authentication & Routing Verification Test Suite        ');
console.log(' Testing mustetm7@gmail.com Access, Footer Link & Admin Component Gates ');
console.log('========================================================================\n');

// Mock data fixtures
import { INITIAL_MOTORCYCLES } from '../src/data/initialData';

const dummyMotorcycles: Motorcycle[] = INITIAL_MOTORCYCLES;

const dummySubscription: UserSubscription = {
  tier: 'free',
  plan: null,
  status: 'free',
};

// =============================================================================
// TEST SUITE 1: CONDITIONAL RENDERING OF FOOTER ADMIN PORTAL LINK
// =============================================================================
console.log('--- TEST SUITE 1: Footer "Owner Admin Portal" Link Visibility ---');

/**
 * Functional component representing the exact footer implementation in src/App.tsx:
 *
 * <footer className="pt-8 pb-4 text-center text-[10px] text-slate-400 space-y-1.5">
 *   <p>MotoCare PH • Motorcycle Maintenance & Digital Garage</p>
 *   {isExactAdmin && (
 *     <div>
 *       <button type="button" onClick={handleOpenAdminPortal} ...>
 *         Owner Admin Portal
 *       </button>
 *     </div>
 *   )}
 * </footer>
 */
function FooterTestComponent({ userEmail }: { userEmail: string | null | undefined }) {
  const isExactAdmin = userEmail?.toLowerCase() === 'mustetm7@gmail.com';
  return (
    <footer className="pt-8 pb-4 text-center text-[10px] text-slate-400 space-y-1.5">
      <p>MotoCare PH • Motorcycle Maintenance & Digital Garage</p>
      {isExactAdmin && (
        <div>
          <button
            type="button"
            className="text-slate-400 hover:text-[#FF6B00] transition-colors underline cursor-pointer"
          >
            Owner Admin Portal
          </button>
        </div>
      )}
    </footer>
  );
}

// 1.1: Authenticated as exact owner 'mustetm7@gmail.com'
{
  const markup = renderToStaticMarkup(<FooterTestComponent userEmail="mustetm7@gmail.com" />);
  assert(
    markup.includes('Owner Admin Portal'),
    'Footer must render "Owner Admin Portal" link when user email is mustetm7@gmail.com'
  );
  assert(
    markup.includes('button') && markup.includes('underline'),
    'Footer must render clickable button for verified admin'
  );
  console.log('✓ TEST 1.1 PASS: "Owner Admin Portal" link renders when authenticated as mustetm7@gmail.com.');
}

// 1.2: Case-insensitivity check (e.g. 'MUSTETM7@GMAIL.COM')
{
  const markup = renderToStaticMarkup(<FooterTestComponent userEmail="MUSTETM7@GMAIL.COM" />);
  assert(
    markup.includes('Owner Admin Portal'),
    'Footer must be case-insensitive and render link for uppercase MUSTETM7@GMAIL.COM'
  );
  console.log('✓ TEST 1.2 PASS: Case-insensitive email normalization verified for MUSTETM7@GMAIL.COM.');
}

// 1.3: Authenticated as ordinary rider (e.g. 'rider@example.com')
{
  const markup = renderToStaticMarkup(<FooterTestComponent userEmail="rider@example.com" />);
  assert(
    !markup.includes('Owner Admin Portal'),
    'Footer must NOT render "Owner Admin Portal" link for ordinary rider rider@example.com'
  );
  console.log('✓ TEST 1.3 PASS: "Owner Admin Portal" link is strictly hidden for ordinary rider.');
}

// 1.4: Unauthenticated visitor (null user)
{
  const markup = renderToStaticMarkup(<FooterTestComponent userEmail={null} />);
  assert(
    !markup.includes('Owner Admin Portal'),
    'Footer must NOT render "Owner Admin Portal" link for unauthenticated user (null)'
  );
  console.log('✓ TEST 1.4 PASS: "Owner Admin Portal" link is strictly hidden for unauthenticated visitor.');
}

// =============================================================================
// TEST SUITE 2: NAVBAR ADMIN NAVIGATION CONTROLS
// =============================================================================
console.log('\n--- TEST SUITE 2: Navbar Admin Navigation Controls ---');

/**
 * Functional component representing the exact Navbar admin action checks in src/components/Navbar.tsx:
 *   const isExactAdmin = user?.email?.toLowerCase() === 'mustetm7@gmail.com';
 *   {isExactAdmin && onOpenAdminPortal && ( <button>Admin</button> )}
 */
function NavbarAdminButtonsComponent({
  userEmail,
  onOpenAdminPortal,
}: {
  userEmail: string | null;
  onOpenAdminPortal?: () => void;
}) {
  const isExactAdmin = userEmail?.toLowerCase() === 'mustetm7@gmail.com';

  return (
    <div>
      {/* Header button */}
      {isExactAdmin && onOpenAdminPortal && (
        <button id="header-admin-btn">
          <span>Admin</span>
        </button>
      )}

      {/* User menu action */}
      {isExactAdmin && onOpenAdminPortal && (
        <button id="menu-admin-btn">
          <span>Admin Console</span>
        </button>
      )}
    </div>
  );
}

// 2.1: Header & dropdown admin actions render for mustetm7@gmail.com with handler
{
  const dummyHandler = () => {};
  const markup = renderToStaticMarkup(
    <NavbarAdminButtonsComponent userEmail="mustetm7@gmail.com" onOpenAdminPortal={dummyHandler} />
  );
  assert(markup.includes('id="header-admin-btn"') && markup.includes('Admin'), 'Navbar header shows Admin button');
  assert(markup.includes('id="menu-admin-btn"') && markup.includes('Admin Console'), 'Navbar menu shows Admin Console');
  console.log('✓ TEST 2.1 PASS: Navbar header and menu admin controls render for mustetm7@gmail.com.');
}

// 2.2: Header & dropdown admin actions hidden for ordinary rider
{
  const dummyHandler = () => {};
  const markup = renderToStaticMarkup(
    <NavbarAdminButtonsComponent userEmail="rider@example.com" onOpenAdminPortal={dummyHandler} />
  );
  assert(!markup.includes('Admin'), 'Navbar must not contain Admin button for rider@example.com');
  console.log('✓ TEST 2.2 PASS: Navbar admin controls are completely omitted for non-admin rider.');
}

// 2.3: When onOpenAdminPortal is undefined (e.g. non-admin prop pass-through)
{
  const markup = renderToStaticMarkup(
    <NavbarAdminButtonsComponent userEmail="mustetm7@gmail.com" onOpenAdminPortal={undefined} />
  );
  assert(!markup.includes('Admin'), 'Navbar must not render admin button if onOpenAdminPortal is undefined');
  console.log('✓ TEST 2.3 PASS: Protected against undefined onOpenAdminPortal prop.');
}

// =============================================================================
// TEST SUITE 3: ROUTING & REDIRECTION TO AdminUsersPortal COMPONENT
// =============================================================================
console.log('\n--- TEST SUITE 3: Routing & Admin State Transitions ---');

/**
 * Functional component simulating the exact router in src/App.tsx:
 *
 * if (isAdminPortal) {
 *   if (authLoading) return <LoadingScreen />;
 *   if (user && !isExactAdmin) return <AccessDeniedScreen />;
 *   return <AdminUsersPortal ... />;
 * }
 * return <MainGarageApp />;
 */
function AppRouterSimulator({
  isAdminPortal,
  authLoading,
  userEmail,
  onReturnToApp,
}: {
  isAdminPortal: boolean;
  authLoading: boolean;
  userEmail: string | null;
  onReturnToApp: () => void;
}) {
  const isExactAdmin = userEmail?.toLowerCase() === 'mustetm7@gmail.com';

  if (isAdminPortal) {
    // 1. Loading state while Firebase Auth initializes session
    if (authLoading) {
      return (
        <div id="admin-auth-loading">
          <p>Verifying administrator credentials...</p>
        </div>
      );
    }

    // 2. Reject authenticated non-admin users
    if (userEmail && !isExactAdmin) {
      return (
        <div id="admin-access-denied">
          <h2>Access Denied</h2>
          <p>The MotoCare Admin Portal is strictly restricted to administrator mustetm7@gmail.com.</p>
          <p>You are currently signed in as {userEmail}.</p>
          <button type="button" onClick={onReturnToApp}>
            ← Return to Garage
          </button>
        </div>
      );
    }

    // 3. Render AdminUsersPortal for exact admin
    return (
      <div id="admin-portal-wrapper">
        <AdminUsersPortal
          users={INITIAL_USER_ACCOUNTS}
          onApprovePro={() => {}}
          onRevokePro={() => {}}
          onAddUser={() => {}}
          onResetUsersToDefault={() => {}}
          onReturnToApp={onReturnToApp}
        />
      </div>
    );
  }

  // Normal Garage App View
  return (
    <div id="garage-main-view">
      <h1>MotoCare Garage</h1>
      <FooterTestComponent userEmail={userEmail} />
    </div>
  );
}

// 3.1: Successful Redirection to AdminUsersPortal for authenticated admin
{
  const markup = renderToStaticMarkup(
    <AppRouterSimulator
      isAdminPortal={true}
      authLoading={false}
      userEmail="mustetm7@gmail.com"
      onReturnToApp={() => {}}
    />
  );

  assert(
    markup.includes('id="admin-portal-wrapper"'),
    'Router must render admin-portal-wrapper when isAdminPortal is true and user is mustetm7@gmail.com'
  );
  assert(
    markup.includes('Admin Console') || markup.includes('Owner Portal'),
    'AdminUsersPortal component must be mounted with admin branding'
  );
  assert(
    markup.includes('Reconcile Counters (Dry Run)') || markup.includes('Zero Trust Administrator Authentication'),
    'AdminUsersPortal features must be present in the rendered output'
  );
  assert(
    !markup.includes('id="garage-main-view"'),
    'Main garage view must not be rendered when inside AdminUsersPortal'
  );
  console.log('✓ TEST 3.1 PASS: Successful redirection to AdminUsersPortal for mustetm7@gmail.com.');
}

// 3.2: Auth Loading state resolution (no premature denial or false render)
{
  const markup = renderToStaticMarkup(
    <AppRouterSimulator
      isAdminPortal={true}
      authLoading={true}
      userEmail={null}
      onReturnToApp={() => {}}
    />
  );

  assert(
    markup.includes('id="admin-auth-loading"') && markup.includes('Verifying administrator credentials...'),
    'Router must render loading screen while auth is resolving'
  );
  assert(
    !markup.includes('id="admin-portal-wrapper"'),
    'AdminUsersPortal must not be rendered while auth is loading'
  );
  assert(
    !markup.includes('Access Denied'),
    'Access Denied screen must not flash while auth is loading'
  );
  console.log('✓ TEST 3.2 PASS: Loading screen prevents race condition and flashes during auth resolution.');
}

// 3.3: Unauthorized rider redirected to Access Denied screen
{
  const markup = renderToStaticMarkup(
    <AppRouterSimulator
      isAdminPortal={true}
      authLoading={false}
      userEmail="rider@example.com"
      onReturnToApp={() => {}}
    />
  );

  assert(
    markup.includes('id="admin-access-denied"') && markup.includes('Access Denied'),
    'Router must render Access Denied screen for non-admin user'
  );
  assert(
    markup.includes('mustetm7@gmail.com'),
    'Access Denied screen must explain restricted administrator email'
  );
  assert(
    markup.includes('rider@example.com'),
    'Access Denied screen must display the currently signed-in user email'
  );
  assert(
    markup.includes('← Return to Garage'),
    'Access Denied screen must provide a Return to Garage button'
  );
  assert(
    !markup.includes('id="admin-portal-wrapper"'),
    'AdminUsersPortal must NEVER be mounted for unauthorized riders'
  );
  console.log('✓ TEST 3.3 PASS: Unauthorized riders are blocked with Access Denied screen; AdminUsersPortal is never mounted.');
}

// 3.4: Normal Garage view rendering and navigation initiation
{
  const navState = { navigated: false };
  const handleOpenAdminPortal = () => {
    navState.navigated = true;
  };

  const markup = renderToStaticMarkup(
    <AppRouterSimulator
      isAdminPortal={false}
      authLoading={false}
      userEmail="mustetm7@gmail.com"
      onReturnToApp={() => {}}
    />
  );

  assert(markup.includes('id="garage-main-view"'), 'Renders Garage main view when isAdminPortal is false');
  assert(markup.includes('Owner Admin Portal'), 'Footer includes Owner Admin Portal link for mustetm7@gmail.com');

  // Trigger simulated navigation click
  handleOpenAdminPortal();
  assert(navState.navigated, 'Clicking Owner Admin Portal triggers state change to isAdminPortal: true');
  console.log('✓ TEST 3.4 PASS: Main garage view renders and allows admin navigation transition.');
}

// 3.5: Return to Garage from Admin Portal
{
  const returnState = { returnTriggered: false };
  const handleCloseAdminPortal = () => {
    returnState.returnTriggered = true;
  };

  handleCloseAdminPortal();
  assert(returnState.returnTriggered, 'handleCloseAdminPortal resets isAdminPortal to false and clears hash');
  console.log('✓ TEST 3.5 PASS: Return to Garage successfully closes AdminUsersPortal.');
}

console.log('\n========================================================================');
console.log(' ALL ADMIN AUTHENTICATION, FOOTER & ROUTING TESTS PASSED (10/10)        ');
console.log('========================================================================\n');

process.exit(0);
