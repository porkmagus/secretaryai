"use client";

import type { ReactNode } from "react";

export type MessageListProps = {
  children?: ReactNode;
};

export function MessageList({ children }: MessageListProps) {
  return children;
}
