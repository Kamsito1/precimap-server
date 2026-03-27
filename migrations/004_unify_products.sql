-- Migracion 004: Unificar nombres de productos
-- Fecha: 2026-03-27
UPDATE prices SET product = 'Cana de cerveza' WHERE product IN ('Cerveza cana 200ml', 'Cerveza');
UPDATE places SET category = 'restaurante' WHERE category IN ('bar', 'cafe');
