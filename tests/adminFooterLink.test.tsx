import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import App from '../src/App';
import * as AuthContextModule from '../src/context/AuthContext';

vi.mock('../src/context/AuthContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/context/AuthContext')>();
  return {
    ...actual,
    useAuth: vi.fn(),
    AuthProvider: ({ children }: { children: React.ReactNode }) => children,
  };
});

describe('MotoCare Admin Portal Footer Visibility (Vitest & React Testing Library)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.location.hash = '';
    window.history.pushState({}, '', '/');

    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  it('renders "Owner Admin Portal" footer link when authenticated as mustetm7@gmail.com', () => {
    vi.mocked(AuthContextModule.useAuth).mockReturnValue({
      user: {
        email: 'mustetm7@gmail.com',
        uid: 'admin-uid-123',
        displayName: 'Owner Admin',
        emailVerified: true,
      } as any,
      loading: false,
      isAdmin: true,
      subscription: { tier: 'pro', plan: 'monthly', status: 'active' },
      submitPaymentRef: vi.fn(),
      signIn: vi.fn(),
      signInWithEmail: vi.fn(),
      signUpWithEmail: vi.fn(),
      resetPassword: vi.fn(),
      signOut: vi.fn(),
    });

    render(<App />);

    const adminLink = screen.getByText('Owner Admin Portal');
    expect(adminLink).not.toBeNull();
    expect(adminLink.tagName.toLowerCase()).toBe('button');
  });

  it('hides "Owner Admin Portal" footer link when authenticated as a different user (e.g. rider@example.com)', () => {
    vi.mocked(AuthContextModule.useAuth).mockReturnValue({
      user: {
        email: 'rider@example.com',
        uid: 'rider-uid-456',
        displayName: 'Regular Rider',
        emailVerified: true,
      } as any,
      loading: false,
      isAdmin: false,
      subscription: { tier: 'free', plan: null, status: 'free' },
      submitPaymentRef: vi.fn(),
      signIn: vi.fn(),
      signInWithEmail: vi.fn(),
      signUpWithEmail: vi.fn(),
      resetPassword: vi.fn(),
      signOut: vi.fn(),
    });

    render(<App />);

    const adminLink = screen.queryByText('Owner Admin Portal');
    expect(adminLink).toBeNull();
  });

  it('hides "Owner Admin Portal" footer link when user is unauthenticated (null)', () => {
    vi.mocked(AuthContextModule.useAuth).mockReturnValue({
      user: null,
      loading: false,
      isAdmin: false,
      subscription: { tier: 'free', plan: null, status: 'free' },
      submitPaymentRef: vi.fn(),
      signIn: vi.fn(),
      signInWithEmail: vi.fn(),
      signUpWithEmail: vi.fn(),
      resetPassword: vi.fn(),
      signOut: vi.fn(),
    });

    render(<App />);

    const adminLink = screen.queryByText('Owner Admin Portal');
    expect(adminLink).toBeNull();
  });

  it('renders "Owner Admin Portal" footer link with case-insensitive email matching (MUSTETM7@GMAIL.COM)', () => {
    vi.mocked(AuthContextModule.useAuth).mockReturnValue({
      user: {
        email: 'MUSTETM7@GMAIL.COM',
        uid: 'admin-uid-123',
        displayName: 'Owner Admin',
        emailVerified: true,
      } as any,
      loading: false,
      isAdmin: true,
      subscription: { tier: 'pro', plan: 'monthly', status: 'active' },
      submitPaymentRef: vi.fn(),
      signIn: vi.fn(),
      signInWithEmail: vi.fn(),
      signUpWithEmail: vi.fn(),
      resetPassword: vi.fn(),
      signOut: vi.fn(),
    });

    render(<App />);

    const adminLink = screen.getByText('Owner Admin Portal');
    expect(adminLink).not.toBeNull();
  });
});
