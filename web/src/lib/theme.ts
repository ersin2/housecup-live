import { useEffect } from 'react';
import type { ThemeMode } from '@housecup/shared/types';

const META: Record<ThemeMode, string> = { daylight: '#FFFFFF', arena: '#070A12' };

/** Apply a theme to <html> for as long as the calling page is mounted. */
export function useDocumentTheme(theme: ThemeMode) {
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', META[theme]);
  }, [theme]);
}

export function useDocumentTitle(title: string) {
  useEffect(() => {
    document.title = title;
  }, [title]);
}
