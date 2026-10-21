"use client";

import { createContext } from "react";

/**
 * Where a stored figure the student works with reports back (prototype,
 * lib/figure-interactions). The lesson chat provides its widget-note sink, so
 * a figure in a tutor message or on a question card sends one note per step.
 * No provider (the gallery, practice, the spine dock): the figure stays a
 * plain animated figure.
 */
export const FigureNoteContext = createContext<((note: string) => void) | null>(null);
