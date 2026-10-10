-- The CDN counter moved off the girlsbands.com site: the pages are counted at Gcore's edge now and the static
-- files and images at the gbcclub.com EdgeOne site, each under a source label in domain (see
-- packages/backend/src/operations/edgeanalytics.ts and gcoreanalytics.ts). Rows tagged with the old hostname
-- describe an edge that no longer serves the site, and the two new sources are not comparable with it, so
-- drop them rather than leave them to be read as if they were a source.
DELETE FROM edge_traffic_daily WHERE domain = 'girlsbands.com';
