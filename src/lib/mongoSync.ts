'use server';

import type { Db } from 'mongodb';
import pool from '@/lib/db';
import { getMongoDb } from '@/lib/mongodb';
import { normalizeAdName } from '@/lib/utils/csvProcessor';

const REG_DATE_COLS = ['FECHA_REGISTRO', 'FECHA', 'FECHA_CAPTACION', 'FECHA_REGISTO', 'fecha_registro', 'created_at'];
const CLIENTE_COLS = ['#', 'cliente_id', 'CLIENTE_ID'];

function getClienteId(row: Record<string, unknown>): string {
    for (const col of CLIENTE_COLS) {
        const val = row[col];
        if (val != null && String(val).trim() !== '') return String(val);
    }
    return '';
}

function toIsoDate(val: unknown): Date | null {
    if (!val) return null;
    if (val instanceof Date) return val;
    const d = new Date(String(val));
    return isNaN(d.getTime()) ? null : d;
}

function rowToDoc(row: Record<string, unknown>, configId: string): Record<string, unknown> {
    const doc: Record<string, unknown> = { ...row };
    doc.config_id = configId;
    doc.cliente_id = getClienteId(row);
    doc._synced_at = new Date();

    const anuncio = row['ANUNCIO'] ?? row['anuncio'] ?? '';
    const segmentacion = row['SEGMENTACION'] ?? row['segmentacion'] ?? '';
    doc.anuncio = String(anuncio || '').trim();
    doc.segmentacion = String(segmentacion || '').trim();
    doc.anuncio_normalized = normalizeAdName(String(anuncio));
    doc.segmentacion_normalized = normalizeAdName(String(segmentacion));

    doc.campana = String(row['CAMPAÑA'] ?? row['CAMPANA'] ?? row['campana'] ?? '').trim();
    doc.ad_id = String(row['AD_ID'] ?? row['ad_id'] ?? '').trim();
    doc.pais = String(row['PAIS'] ?? row['PAÍS'] ?? row['COUNTRY'] ?? row['pais'] ?? row['country'] ?? 'Sin país').trim();

    doc.qlead = String(row['QLEAD'] ?? row['qlead'] ?? '').trim();
    doc.ingresos = String(row['INGRESOS'] ?? row['ingresos'] ?? '').trim();
    doc.estudios = String(row['ESTUDIOS'] ?? row['estudios'] ?? '').trim();
    doc.ocupacion = String(row['OCUPACION'] ?? row['ocupacion'] ?? '').trim();
    doc.proposito = String(row['PROPOSITO'] ?? row['proposito'] ?? '').trim();
    doc.edad_especifica = String(row['EDAD_ESPECIFICA'] ?? row['edad_especifica'] ?? '').trim();
    doc.puntaje = row['PUNTAJE'] != null ? parseFloat(String(row['PUNTAJE'])) : 0;

    const regCol = REG_DATE_COLS.find((c) => row[c] != null);
    if (regCol) {
        const d = toIsoDate(row[regCol]);
        doc.fecha_registro = d;
    }

    return doc;
}

export async function syncMySQLToMongo(
    baseTable: string,
    salesTable: string
): Promise<{ leadsCount: number; salesCount: number }> {
    const configId = `${baseTable}|${salesTable}`;
    const db = await getMongoDb();
    const leadsCol = db.collection('leads');
    const salesCol = db.collection('sales');

    const [baseRows] = await pool.query(`SELECT * FROM \`${baseTable}\``) as [Record<string, unknown>[], unknown];
    const [salesRows] = await pool.query(`SELECT * FROM \`${salesTable}\``) as [Record<string, unknown>[], unknown];

    const leadsDocs = (Array.isArray(baseRows) ? baseRows : []).map((r) => rowToDoc(r, configId));
    const SALE_DATE_COLS = ['FECHA', 'FECHA_VENTA', 'fecha', 'fecha_venta', 'created_at', 'purchase_date'];
    const salesDocs = (Array.isArray(salesRows) ? salesRows : []).map((r) => {
        const clienteId = r['cliente_id'] ?? r['CLIENTE_ID'] ?? r['cliente'] ?? '';
        let monto = r['monto'] ?? r['MONTO'] ?? 0;
        if (typeof monto === 'string') monto = parseFloat(String(monto).replace(',', '.')) || 0;
        const fechaCol = SALE_DATE_COLS.find((c) => r[c] != null);
        return {
            config_id: configId,
            cliente_id: String(clienteId),
            monto: Number(monto),
            fecha: fechaCol ? toIsoDate(r[fechaCol]) : null,
            fuente: String(r['fuente'] ?? r['FUENTE'] ?? '').toLowerCase(),
            venta_id: r['venta_id'] ?? r['id'] ?? r['ID'],
            _synced_at: new Date()
        };
    });

    await leadsCol.deleteMany({ config_id: configId });
    await salesCol.deleteMany({ config_id: configId });

    if (leadsDocs.length > 0) {
        await leadsCol.insertMany(leadsDocs);
    }
    if (salesDocs.length > 0) {
        await salesCol.insertMany(salesDocs);
    }

    await ensureMongoIndexes(db);

    return { leadsCount: leadsDocs.length, salesCount: salesDocs.length };
}

async function ensureMongoIndexes(db: Db) {
    try {
        await db.collection('leads').createIndex({ config_id: 1, anuncio_normalized: 1, segmentacion_normalized: 1 }, { background: true });
        await db.collection('leads').createIndex({ config_id: 1, cliente_id: 1 }, { background: true });
        await db.collection('sales').createIndex({ config_id: 1, cliente_id: 1 }, { background: true });
        await db.collection('spend_data').createIndex({ report_id: 1, is_daily: 1 }, { background: true });
    } catch {
    }
}
