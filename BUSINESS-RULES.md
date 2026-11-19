# BUSINESS-RULES.md — Aturan Operasional Perpustakaan

1. **Integritas Eksemplar**: Satu eksemplar hanya dapat dipinjam oleh satu anggota pada satu waktu. Status diperbarui atomik dengan syarat `WHERE id = ? AND status = 'Tersedia'`.
2. **Validasi Anggota**: Anggota berstatus `Diblokir` atau `Nonaktif`, masa berlaku lewat (`expires_at < today`), atau tunggakan denda melebihi batas maksimal tidak dapat melakukan peminjaman.
3. **Batas Peminjaman & Kebijakan Koleksi**: Jumlah pinjaman aktif + buku baru tidak boleh melebihi `max_loans` jenis keanggotaan. Buku `is_reference_only` dan `read_in_place_only` tidak boleh dipinjam keluar.
4. **Idempotency Transaksi**: Endpoint peminjaman menerima `idempotency_key` unik untuk mencegah transaksi ganda akibat klik berulang atau sinkronisasi ulang.
5. **Perhitungan Jatuh Tempo & Denda**: Jatuh tempo dihitung otomatis dari `loan_date + loan_duration_days`. Denda keterlambatan menghitung selisih hari setelah `grace_period_days`, dikalikan `daily_fine_rate`, dan dibatasi oleh `max_fine_cap`. Kerusakan/kehilangan dihitung sesuai kondisi fisik saat pengembalian.
6. **Perpanjangan**: Ditolak jika batas `max_renewals` tercapai, buku sudah memiliki antrean reservasi aktif, atau buku terlambat (kecuali `allow_overdue_renewal = true`).
7. **Reservasi FIFO**: Antrean mengikuti urutan `queue_position` dan waktu pengajuan. Saat eksemplar kembali dalam kondisi baik/ringan, sistem otomatis mempromosikan antrean teratas menjadi `Tersedia` dan menahan buku hingga batas waktu ambil; reservasi kedaluwarsa dilepas otomatis.
8. **Pembayaran & Audit**: Pembayaran tidak dapat melebihi sisa tagihan. Pengecualian denda hanya diizinkan oleh peran dengan izin `fines.waive`. Seluruh perubahan master dan transaksi tercatat di `audit_logs`.
9. **Soft Delete / Arsip**: Buku dan anggota dengan riwayat sirkulasi tidak dihapus permanen melainkan diarsipkan (`archived_at`) agar integritas riwayat tetap utuh.
