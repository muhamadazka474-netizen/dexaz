// Katalog keyword & fungsi SQL, dikelompokkan berdasarkan fungsinya.
// Dipakai bersama oleh:
//  - Query Builder (tombol "insert" ke kotak SQL manual)
//  - SQL Library (tab "Referensi SQL" — contoh + penjelasan)

export interface SqlKeywordItem {
  /** Label singkat yang tampil di tombol, mis. "COUNT()" */
  token: string;
  /** Teks yang disisipkan ke editor SQL saat tombol diklik */
  insertText: string;
  /** Contoh penggunaan lengkap (satu baris/blok) untuk SQL Library */
  example: string;
  /** Penjelasan singkat fungsinya */
  description: string;
}

export interface SqlKeywordGroup {
  id: string;
  label: string;
  items: SqlKeywordItem[];
}

export const SQL_KEYWORD_GROUPS: SqlKeywordGroup[] = [
  {
    id: "logical",
    label: "Logika & Perbandingan",
    items: [
      { token: "SELECT", insertText: "SELECT column1, column2", example: "SELECT id, name FROM customers", description: "Menentukan kolom mana saja yang ingin diambil dari tabel." },
      { token: "FROM", insertText: "\nFROM schema.table_name", example: "SELECT * FROM public.customers", description: "Menentukan tabel (dan schema) sumber data yang akan diquery." },
      { token: "WHERE", insertText: "\nWHERE condition", example: "SELECT * FROM orders WHERE status = 'pending'", description: "Memfilter baris berdasarkan satu atau lebih kondisi sebelum ditampilkan." },
      { token: "AND", insertText: " AND ", example: "WHERE status = 'active' AND age > 18", description: "Menggabungkan dua kondisi — baris hanya lolos jika kedua kondisi benar." },
      { token: "OR", insertText: " OR ", example: "WHERE role = 'admin' OR role = 'owner'", description: "Menggabungkan dua kondisi — baris lolos jika salah satu kondisi benar." },
      { token: "NOT", insertText: "NOT ", example: "WHERE NOT is_deleted", description: "Membalik hasil sebuah kondisi (negasi)." },
      { token: "IN", insertText: "IN (value1, value2)", example: "WHERE city IN ('Jakarta', 'Bandung')", description: "Mencocokkan nilai terhadap sekumpulan nilai yang diberikan." },
      { token: "NOT IN", insertText: "NOT IN (value1, value2)", example: "WHERE status NOT IN ('archived', 'deleted')", description: "Kebalikan dari IN — nilai tidak boleh ada di dalam daftar." },
      { token: "BETWEEN", insertText: "BETWEEN value1 AND value2", example: "WHERE price BETWEEN 10000 AND 50000", description: "Memfilter nilai dalam sebuah rentang (inklusif di kedua ujung)." },
      { token: "NOT BETWEEN", insertText: "NOT BETWEEN value1 AND value2", example: "WHERE age NOT BETWEEN 0 AND 12", description: "Memfilter nilai di luar sebuah rentang." },
      { token: "LIKE", insertText: "LIKE '%kata%'", example: "WHERE name LIKE '%budi%'", description: "Pencocokan pola teks case-sensitive; % = sembarang karakter, _ = satu karakter." },
      { token: "ILIKE", insertText: "ILIKE '%kata%'", example: "WHERE email ILIKE '%@gmail.com'", description: "Sama seperti LIKE tapi tidak peduli huruf besar/kecil (PostgreSQL)." },
      { token: "IS NULL", insertText: "IS NULL", example: "WHERE deleted_at IS NULL", description: "Memfilter baris yang nilainya kosong/NULL." },
      { token: "IS NOT NULL", insertText: "IS NOT NULL", example: "WHERE phone IS NOT NULL", description: "Memfilter baris yang nilainya terisi (bukan NULL)." },
    ],
  },
  {
    id: "sorting",
    label: "Urutan, Grup & Batas",
    items: [
      { token: "ORDER BY", insertText: "\nORDER BY column ASC", example: "ORDER BY created_at DESC", description: "Mengurutkan hasil berdasarkan satu atau beberapa kolom." },
      { token: "GROUP BY", insertText: "\nGROUP BY column", example: "GROUP BY department_id", description: "Mengelompokkan baris dengan nilai sama, biasanya dipakai bersama fungsi agregat." },
      { token: "HAVING", insertText: "\nHAVING COUNT(*) > 1", example: "GROUP BY city HAVING COUNT(*) > 10", description: "Memfilter hasil setelah GROUP BY (seperti WHERE, tapi untuk grup)." },
      { token: "LIMIT", insertText: "\nLIMIT 100", example: "LIMIT 100", description: "Membatasi jumlah baris yang dikembalikan." },
      { token: "OFFSET", insertText: "\nOFFSET 0", example: "LIMIT 20 OFFSET 40", description: "Melewati sejumlah baris pertama — dipakai untuk pagination." },
      { token: "DISTINCT", insertText: "DISTINCT ", example: "SELECT DISTINCT city FROM customers", description: "Menghapus baris duplikat dari hasil." },
      { token: "AS", insertText: "AS alias", example: "SELECT full_name AS nama", description: "Memberi alias/nama sementara pada kolom atau tabel." },
    ],
  },
  {
    id: "joins",
    label: "Join & Operasi Set",
    items: [
      { token: "INNER JOIN", insertText: "\nINNER JOIN schema.other_table ON table.id = other_table.table_id", example: "INNER JOIN orders ON customers.id = orders.customer_id", description: "Mengambil baris yang cocok di kedua tabel saja." },
      { token: "LEFT JOIN", insertText: "\nLEFT JOIN schema.other_table ON table.id = other_table.table_id", example: "LEFT JOIN orders ON customers.id = orders.customer_id", description: "Mengambil semua baris tabel kiri, plus baris cocok dari tabel kanan (NULL bila tidak cocok)." },
      { token: "RIGHT JOIN", insertText: "\nRIGHT JOIN schema.other_table ON table.id = other_table.table_id", example: "RIGHT JOIN orders ON customers.id = orders.customer_id", description: "Kebalikan LEFT JOIN — semua baris tabel kanan dipertahankan." },
      { token: "FULL OUTER JOIN", insertText: "\nFULL OUTER JOIN schema.other_table ON table.id = other_table.table_id", example: "FULL OUTER JOIN orders ON customers.id = orders.customer_id", description: "Mengambil semua baris dari kedua tabel, cocok atau tidak." },
      { token: "CROSS JOIN", insertText: "\nCROSS JOIN schema.other_table", example: "CROSS JOIN sizes", description: "Menghasilkan perkalian kartesian — setiap baris tabel A dipasangkan dengan setiap baris tabel B." },
      { token: "UNION", insertText: "\nUNION\nSELECT ...", example: "SELECT city FROM customers UNION SELECT city FROM suppliers", description: "Menggabungkan hasil dua SELECT dan menghapus duplikat." },
      { token: "UNION ALL", insertText: "\nUNION ALL\nSELECT ...", example: "SELECT city FROM customers UNION ALL SELECT city FROM suppliers", description: "Sama seperti UNION, tapi duplikat tetap dipertahankan (lebih cepat)." },
      { token: "INTERSECT", insertText: "\nINTERSECT\nSELECT ...", example: "SELECT email FROM leads INTERSECT SELECT email FROM customers", description: "Mengambil baris yang muncul di kedua hasil SELECT." },
      { token: "EXCEPT", insertText: "\nEXCEPT\nSELECT ...", example: "SELECT email FROM leads EXCEPT SELECT email FROM customers", description: "Mengambil baris dari SELECT pertama yang tidak ada di SELECT kedua." },
    ],
  },
  {
    id: "aggregate",
    label: "Fungsi Agregat",
    items: [
      { token: "COUNT()", insertText: "COUNT(*)", example: "SELECT COUNT(*) FROM orders", description: "Menghitung jumlah baris." },
      { token: "SUM()", insertText: "SUM(column)", example: "SELECT SUM(total) FROM orders", description: "Menjumlahkan nilai numerik pada suatu kolom." },
      { token: "AVG()", insertText: "AVG(column)", example: "SELECT AVG(price) FROM products", description: "Menghitung rata-rata nilai suatu kolom." },
      { token: "MIN()", insertText: "MIN(column)", example: "SELECT MIN(price) FROM products", description: "Mengambil nilai terkecil pada suatu kolom." },
      { token: "MAX()", insertText: "MAX(column)", example: "SELECT MAX(price) FROM products", description: "Mengambil nilai terbesar pada suatu kolom." },
    ],
  },
  {
    id: "math",
    label: "Fungsi Matematika",
    items: [
      { token: "ROUND()", insertText: "ROUND(value, 2)", example: "SELECT ROUND(price, 2) FROM products", description: "Membulatkan angka ke sejumlah desimal tertentu." },
      { token: "CEIL()", insertText: "CEIL(value)", example: "SELECT CEIL(4.2)  -- 5", description: "Membulatkan ke atas ke bilangan bulat terdekat." },
      { token: "FLOOR()", insertText: "FLOOR(value)", example: "SELECT FLOOR(4.8)  -- 4", description: "Membulatkan ke bawah ke bilangan bulat terdekat." },
      { token: "ABS()", insertText: "ABS(value)", example: "SELECT ABS(-15)  -- 15", description: "Mengambil nilai absolut (selalu positif)." },
      { token: "POWER()", insertText: "POWER(base, exponent)", example: "SELECT POWER(2, 10)  -- 1024", description: "Memangkatkan sebuah angka." },
      { token: "MOD()", insertText: "MOD(dividend, divisor)", example: "SELECT MOD(10, 3)  -- 1", description: "Mengambil sisa hasil bagi (modulo)." },
      { token: "SQRT()", insertText: "SQRT(value)", example: "SELECT SQRT(81)  -- 9", description: "Menghitung akar kuadrat." },
    ],
  },
  {
    id: "string",
    label: "Fungsi Teks",
    items: [
      { token: "UPPER()", insertText: "UPPER(column)", example: "SELECT UPPER(name) FROM customers", description: "Mengubah teks menjadi huruf kapital semua." },
      { token: "LOWER()", insertText: "LOWER(column)", example: "SELECT LOWER(email) FROM customers", description: "Mengubah teks menjadi huruf kecil semua." },
      { token: "LENGTH()", insertText: "LENGTH(column)", example: "SELECT LENGTH(description) FROM products", description: "Menghitung panjang (jumlah karakter) sebuah teks." },
      { token: "CONCAT()", insertText: "CONCAT(a, b)", example: "SELECT CONCAT(first_name, ' ', last_name) FROM customers", description: "Menggabungkan dua atau lebih teks menjadi satu." },
      { token: "CONCAT_WS()", insertText: "CONCAT_WS(', ', a, b)", example: "SELECT CONCAT_WS(', ', city, country) FROM customers", description: "Menggabungkan teks dengan pemisah (separator) tertentu." },
      { token: "SUBSTRING()", insertText: "SUBSTRING(column FROM 1 FOR 3)", example: "SELECT SUBSTRING(code FROM 1 FOR 3) FROM products", description: "Mengambil sebagian teks mulai dari posisi tertentu." },
      { token: "TRIM()", insertText: "TRIM(column)", example: "SELECT TRIM(name) FROM customers", description: "Menghapus spasi kosong di awal dan akhir teks." },
      { token: "LTRIM()", insertText: "LTRIM(column)", example: "SELECT LTRIM('  hello')  -- 'hello'", description: "Menghapus spasi kosong di sisi kiri (awal) teks." },
      { token: "RTRIM()", insertText: "RTRIM(column)", example: "SELECT RTRIM('hello  ')  -- 'hello'", description: "Menghapus spasi kosong di sisi kanan (akhir) teks." },
      { token: "REPLACE()", insertText: "REPLACE(column, 'dari', 'ke')", example: "SELECT REPLACE(phone, '-', '') FROM customers", description: "Mengganti setiap kemunculan sebuah substring dengan substring lain." },
      { token: "LEFT()", insertText: "LEFT(column, 3)", example: "SELECT LEFT(phone, 4) FROM customers", description: "Mengambil sejumlah karakter dari sisi kiri teks." },
      { token: "RIGHT()", insertText: "RIGHT(column, 3)", example: "SELECT RIGHT(phone, 4) FROM customers", description: "Mengambil sejumlah karakter dari sisi kanan teks." },
    ],
  },
  {
    id: "datetime",
    label: "Tanggal & Waktu",
    items: [
      { token: "CURRENT_DATE", insertText: "CURRENT_DATE", example: "WHERE created_at::date = CURRENT_DATE", description: "Tanggal hari ini menurut server database." },
      { token: "CURRENT_TIME", insertText: "CURRENT_TIME", example: "SELECT CURRENT_TIME", description: "Jam saat ini menurut server database." },
      { token: "CURRENT_TIMESTAMP", insertText: "CURRENT_TIMESTAMP", example: "INSERT INTO logs (created_at) VALUES (CURRENT_TIMESTAMP)", description: "Tanggal dan jam saat ini (timestamp) menurut server database." },
      { token: "DATE_PART()", insertText: "DATE_PART('year', column)", example: "SELECT DATE_PART('year', order_date) FROM orders", description: "Mengambil bagian tertentu (tahun, bulan, dst.) dari sebuah tanggal." },
      { token: "DATE_TRUNC()", insertText: "DATE_TRUNC('month', column)", example: "SELECT DATE_TRUNC('month', order_date) FROM orders", description: "Membulatkan tanggal ke satuan waktu tertentu (awal bulan, awal tahun, dst.)." },
      { token: "EXTRACT()", insertText: "EXTRACT(YEAR FROM column)", example: "SELECT EXTRACT(YEAR FROM order_date) FROM orders", description: "Mengekstrak komponen tanggal/waktu tertentu (mirip DATE_PART, standar SQL)." },
      { token: "AGE()", insertText: "AGE(column)", example: "SELECT AGE(birth_date) FROM employees", description: "Menghitung selisih umur/durasi antara dua tanggal (PostgreSQL)." },
    ],
  },
  {
    id: "conditional",
    label: "Kondisional & NULL",
    items: [
      { token: "CASE", insertText: "CASE WHEN condition THEN 'A' ELSE 'B' END", example: "SELECT CASE WHEN age >= 18 THEN 'dewasa' ELSE 'anak' END FROM customers", description: "Logika percabangan IF/ELSE di dalam query SQL." },
      { token: "COALESCE()", insertText: "COALESCE(column, 'default')", example: "SELECT COALESCE(nickname, full_name) FROM customers", description: "Mengambil nilai pertama yang tidak NULL dari daftar argumen." },
      { token: "NULLIF()", insertText: "NULLIF(a, b)", example: "SELECT NULLIF(discount, 0) FROM orders", description: "Menghasilkan NULL jika dua nilai sama, jika tidak mengembalikan nilai pertama." },
    ],
  },
  {
    id: "window",
    label: "Fungsi Window",
    items: [
      { token: "ROW_NUMBER()", insertText: "ROW_NUMBER() OVER (ORDER BY column)", example: "SELECT ROW_NUMBER() OVER (ORDER BY created_at) FROM orders", description: "Memberi nomor urut unik pada tiap baris hasil." },
      { token: "RANK()", insertText: "RANK() OVER (ORDER BY column)", example: "SELECT RANK() OVER (ORDER BY score DESC) FROM students", description: "Memberi peringkat, dengan celah nomor jika ada nilai yang sama (tie)." },
      { token: "DENSE_RANK()", insertText: "DENSE_RANK() OVER (ORDER BY column)", example: "SELECT DENSE_RANK() OVER (ORDER BY score DESC) FROM students", description: "Sama seperti RANK, tapi tanpa celah nomor pada nilai yang sama." },
      { token: "LAG()", insertText: "LAG(column) OVER (ORDER BY column)", example: "SELECT LAG(total) OVER (ORDER BY order_date) FROM orders", description: "Mengambil nilai dari baris sebelumnya dalam urutan yang sama." },
      { token: "LEAD()", insertText: "LEAD(column) OVER (ORDER BY column)", example: "SELECT LEAD(total) OVER (ORDER BY order_date) FROM orders", description: "Mengambil nilai dari baris berikutnya dalam urutan yang sama." },
      { token: "FIRST_VALUE()", insertText: "FIRST_VALUE(column) OVER (ORDER BY column)", example: "SELECT FIRST_VALUE(total) OVER (PARTITION BY customer_id ORDER BY order_date) FROM orders", description: "Mengambil nilai pertama dalam sebuah partisi/urutan." },
      { token: "LAST_VALUE()", insertText: "LAST_VALUE(column) OVER (ORDER BY column)", example: "SELECT LAST_VALUE(total) OVER (PARTITION BY customer_id ORDER BY order_date) FROM orders", description: "Mengambil nilai terakhir dalam sebuah partisi/urutan." },
      { token: "SUM() OVER()", insertText: "SUM(column) OVER (PARTITION BY group_column)", example: "SELECT SUM(total) OVER (PARTITION BY customer_id) FROM orders", description: "Jumlah berjalan/per kelompok tanpa meringkas baris (window function)." },
      { token: "AVG() OVER()", insertText: "AVG(column) OVER (PARTITION BY group_column)", example: "SELECT AVG(total) OVER (PARTITION BY customer_id) FROM orders", description: "Rata-rata per kelompok tanpa meringkas baris (window function)." },
      { token: "COUNT() OVER()", insertText: "COUNT(column) OVER (PARTITION BY group_column)", example: "SELECT COUNT(*) OVER (PARTITION BY customer_id) FROM orders", description: "Jumlah baris per kelompok tanpa meringkas baris (window function)." },
    ],
  },
  {
    id: "casting",
    label: "Konversi Tipe & Subquery",
    items: [
      { token: "CAST()", insertText: "CAST(column AS INTEGER)", example: "SELECT CAST(price AS INTEGER) FROM products", description: "Mengonversi nilai dari satu tipe data ke tipe data lain." },
      { token: "CONVERT()", insertText: "CONVERT(column, INTEGER)", example: "SELECT CONVERT(price, INTEGER)", description: "Alternatif konversi tipe data (tergantung dialek database)." },
      { token: "EXISTS", insertText: "EXISTS (SELECT 1 FROM other_table WHERE condition)", example: "WHERE EXISTS (SELECT 1 FROM orders WHERE orders.customer_id = customers.id)", description: "True jika subquery mengembalikan minimal satu baris." },
      { token: "NOT EXISTS", insertText: "NOT EXISTS (SELECT 1 FROM other_table WHERE condition)", example: "WHERE NOT EXISTS (SELECT 1 FROM orders WHERE orders.customer_id = customers.id)", description: "True jika subquery tidak mengembalikan baris sama sekali." },
      { token: "ANY", insertText: "= ANY (subquery)", example: "WHERE price = ANY (SELECT price FROM discounts)", description: "True jika kondisi cocok dengan salah satu nilai hasil subquery." },
      { token: "ALL", insertText: "= ALL (subquery)", example: "WHERE price > ALL (SELECT price FROM discounts)", description: "True jika kondisi cocok dengan semua nilai hasil subquery." },
    ],
  },
  {
    id: "ddl",
    label: "DDL — Struktur Database",
    items: [
      { token: "CREATE TABLE", insertText: "CREATE TABLE schema.new_table (\n  id SERIAL PRIMARY KEY\n)", example: "CREATE TABLE public.products (id SERIAL PRIMARY KEY, name TEXT)", description: "Membuat tabel baru." },
      { token: "ALTER TABLE", insertText: "ALTER TABLE schema.table_name ADD COLUMN new_column TEXT", example: "ALTER TABLE products ADD COLUMN sku TEXT", description: "Mengubah struktur tabel yang sudah ada (tambah/ubah/hapus kolom)." },
      { token: "DROP TABLE", insertText: "DROP TABLE schema.table_name", example: "DROP TABLE temp_import", description: "Menghapus tabel beserta seluruh isinya secara permanen." },
      { token: "TRUNCATE", insertText: "TRUNCATE TABLE schema.table_name", example: "TRUNCATE TABLE logs", description: "Mengosongkan semua baris tabel dengan cepat, struktur tabel tetap ada." },
      { token: "CREATE INDEX", insertText: "CREATE INDEX idx_name ON schema.table_name (column)", example: "CREATE INDEX idx_orders_customer ON orders (customer_id)", description: "Membuat index untuk mempercepat pencarian pada kolom tertentu." },
      { token: "DROP INDEX", insertText: "DROP INDEX idx_name", example: "DROP INDEX idx_orders_customer", description: "Menghapus index yang sudah ada." },
      { token: "CREATE VIEW", insertText: "CREATE VIEW schema.view_name AS\nSELECT * FROM schema.table_name", example: "CREATE VIEW active_customers AS SELECT * FROM customers WHERE is_active", description: "Membuat view — query tersimpan yang bisa diperlakukan seperti tabel." },
      { token: "DROP VIEW", insertText: "DROP VIEW schema.view_name", example: "DROP VIEW active_customers", description: "Menghapus view yang sudah ada." },
      { token: "CREATE DATABASE", insertText: "CREATE DATABASE database_name", example: "CREATE DATABASE reporting", description: "Membuat database baru." },
      { token: "DROP DATABASE", insertText: "DROP DATABASE database_name", example: "DROP DATABASE reporting_old", description: "Menghapus database beserta seluruh isinya secara permanen." },
      { token: "CREATE SCHEMA", insertText: "CREATE SCHEMA schema_name", example: "CREATE SCHEMA analytics", description: "Membuat schema baru sebagai wadah tabel-tabel terkait." },
      { token: "DROP SCHEMA", insertText: "DROP SCHEMA schema_name", example: "DROP SCHEMA analytics", description: "Menghapus schema beserta seluruh objek di dalamnya." },
    ],
  },
  {
    id: "dml",
    label: "DML — Manipulasi Data",
    items: [
      { token: "INSERT INTO", insertText: "INSERT INTO schema.table_name (column1, column2) VALUES ('nilai1', 'nilai2')", example: "INSERT INTO customers (name, email) VALUES ('Budi', 'budi@mail.com')", description: "Menambahkan baris baru ke sebuah tabel." },
      { token: "UPDATE", insertText: "UPDATE schema.table_name SET column = 'nilai baru' WHERE id = 1", example: "UPDATE customers SET status = 'active' WHERE id = 42", description: "Mengubah nilai kolom pada baris yang sudah ada." },
      { token: "DELETE", insertText: "DELETE FROM schema.table_name WHERE id = 1", example: "DELETE FROM customers WHERE id = 42", description: "Menghapus baris dari sebuah tabel." },
      { token: "RETURNING", insertText: "RETURNING *", example: "INSERT INTO customers (name) VALUES ('Budi') RETURNING id", description: "Mengembalikan kolom dari baris yang terkena INSERT/UPDATE/DELETE (PostgreSQL)." },
    ],
  },
  {
    id: "transaction",
    label: "Transaksi",
    items: [
      { token: "BEGIN", insertText: "BEGIN;", example: "BEGIN;", description: "Memulai sebuah transaksi baru." },
      { token: "COMMIT", insertText: "COMMIT;", example: "COMMIT;", description: "Menyimpan permanen semua perubahan dalam transaksi saat ini." },
      { token: "ROLLBACK", insertText: "ROLLBACK;", example: "ROLLBACK;", description: "Membatalkan semua perubahan dalam transaksi saat ini." },
      { token: "SAVEPOINT", insertText: "SAVEPOINT nama_savepoint;", example: "SAVEPOINT before_update;", description: "Membuat titik penanda di tengah transaksi untuk rollback sebagian." },
    ],
  },
];
