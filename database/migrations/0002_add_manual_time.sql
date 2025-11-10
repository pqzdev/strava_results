-- Migration: Add manual_time column to races table
-- This allows athletes to manually override their elapsed time

ALTER TABLE races ADD COLUMN manual_time INTEGER; -- seconds, NULL if not manually set
