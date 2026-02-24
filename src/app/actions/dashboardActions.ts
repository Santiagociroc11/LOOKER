'use server';

import pool from '@/lib/db';
import { processSpendCSV, processCountryCSV, normalizeAdName, cleanDisplayName } from '@/lib/utils/csvProcessor';
import { buildQualityAnalysis } from '@/lib/utils/qualityAnalysis';
import { RowDataPacket } from 'mysql2';

export async function getAvailableTables() {
    try {
        const [rows] = await pool.query<RowDataPacket[]>('SHOW TABLES');
        return rows.map((row) => Object.values(row)[0] as string);
    } catch (error) {
        console.error('Error fetching tables:', error);
        throw new Error('Could not fetch available tables.');
    }
}

async function columnExists(tableName: string, columnName: string): Promise<boolean> {
    try {
        const query = `SHOW COLUMNS FROM \`${tableName}\` LIKE ?`;
        const [rows] = await pool.query<RowDataPacket[]>(query, [columnName]);
        return rows.length > 0;
    } catch (error) {
        console.error(`Error checking column ${columnName} in table ${tableName}:`, error);
        return false;
    }
}

async function getRevenueData(baseTable: string, salesTable: string, multiplyRevenue = false) {
    try {
        const hasAdId = await columnExists(baseTable, 'AD_ID');
        const revenueMultiplier = multiplyRevenue ? '* 2' : '';

        // Safety check on table names: in production we would validate against a whitelist.
        // For now we use standard backticks and rely on parameterization for values.
        const adIdSelect = hasAdId ? "COALESCE(l.AD_ID, '') AS AD_ID" : "' ' AS AD_ID";
        const groupByClause = hasAdId ? "l.ANUNCIO, l.SEGMENTACION, l.CAMPAÑA, l.AD_ID" : "l.ANUNCIO, l.SEGMENTACION, l.CAMPAÑA";

        const query = `
      SELECT
          l.ANUNCIO,
          l.SEGMENTACION,
          l.CAMPAÑA,
          ${adIdSelect},
          COUNT(l.\`#\`) AS total_leads,
          COUNT(v.cliente_id) AS total_sales,
          COALESCE(SUM(CAST(REPLACE(v.monto, ',', '.') AS DECIMAL(10, 2))) ${revenueMultiplier}, 0) AS total_revenue
      FROM \`${baseTable}\` AS l
      LEFT JOIN \`${salesTable}\` AS v ON l.\`#\` = v.cliente_id AND (v.fuente IS NULL OR LOWER(v.fuente) NOT LIKE '%org%')
      WHERE l.ANUNCIO IS NOT NULL AND l.ANUNCIO != '' AND l.SEGMENTACION IS NOT NULL
      GROUP BY ${groupByClause};
    `;

        const [rows] = await pool.query<any[]>(query);

        return rows.map(row => ({
            ...row,
            ANUNCIO_NORMALIZED: normalizeAdName(row.ANUNCIO),
            SEGMENTACION_NORMALIZED: normalizeAdName(row.SEGMENTACION),
        }));
    } catch (error) {
        console.error('Database Error getRevenueData:', error);
        return null;
    }
}

async function getDateColumn(tableName: string, candidates: string[]): Promise<string | null> {
    for (const col of candidates) {
        if (await columnExists(tableName, col)) return col;
    }
    return null;
}

async function getPurchasesByDaysSinceRegistration(
    baseTable: string,
    salesTable: string,
    multiplyRevenue: boolean
): Promise<{ days: number; count: number; revenue: number }[] | null> {
    const regDateCandidates = ['FECHA_REGISTRO', 'FECHA', 'FECHA_CAPTACION', 'FECHA_REGISTO', 'fecha_registro', 'created_at'];
    const saleDateCandidates = ['FECHA', 'FECHA_VENTA', 'fecha', 'fecha_venta', 'created_at', 'purchase_date'];

    const regCol = await getDateColumn(baseTable, regDateCandidates);
    const saleCol = await getDateColumn(salesTable, saleDateCandidates);

    if (!regCol || !saleCol) return null;

    try {
        const revenueMultiplier = multiplyRevenue ? '* 2' : '';
        const query = `
            SELECT
                DATEDIFF(v.\`${saleCol}\`, l.\`${regCol}\`) AS days_since_reg,
                COUNT(v.cliente_id) AS sale_count,
                COALESCE(SUM(CAST(REPLACE(v.monto, ',', '.') AS DECIMAL(10, 2))) ${revenueMultiplier}, 0) AS total_revenue
            FROM \`${baseTable}\` AS l
            INNER JOIN \`${salesTable}\` AS v ON l.\`#\` = v.cliente_id
            WHERE v.\`${saleCol}\` IS NOT NULL AND l.\`${regCol}\` IS NOT NULL
              AND DATEDIFF(v.\`${saleCol}\`, l.\`${regCol}\`) >= 0
            GROUP BY days_since_reg
            ORDER BY days_since_reg ASC
        `;
        const [rows] = await pool.query<any[]>(query);
        return rows.map((r) => ({
            days: parseInt(r.days_since_reg, 10) || 0,
            count: parseInt(r.sale_count, 10) || 0,
            revenue: parseFloat(r.total_revenue) || 0
        }));
    } catch (error) {
        console.error('Error getPurchasesByDaysSinceRegistration:', error);
        return null;
    }
}

async function getSalesByRegistrationDate(
    baseTable: string,
    salesTable: string,
    multiplyRevenue: boolean,
    segmentationsData?: Record<string, { spend: number }>,
    spendByDate?: Record<string, number>
): Promise<{ date: string; leads: number; sales: number; revenue: number; ads?: { anuncio: string; segmentacion: string; leads: number; sales: number; revenue: number; gasto: number; roas: number }[] }[] | null> {
    const regDateCandidates = ['FECHA_REGISTRO', 'FECHA', 'FECHA_CAPTACION', 'FECHA_REGISTO', 'fecha_registro', 'created_at'];
    const regCol = await getDateColumn(baseTable, regDateCandidates);
    if (!regCol) return null;

    const hasAnuncio = await columnExists(baseTable, 'ANUNCIO');
    const hasSegmentacion = await columnExists(baseTable, 'SEGMENTACION');

    try {
        const revenueMultiplier = multiplyRevenue ? '* 2' : '';
        const query = `
            SELECT
                DATE(l.\`${regCol}\`) AS fecha_reg,
                COUNT(DISTINCT l.\`#\`) AS total_leads,
                COUNT(DISTINCT v.cliente_id) AS total_sales,
                COALESCE(SUM(CAST(REPLACE(v.monto, ',', '.') AS DECIMAL(10, 2))) ${revenueMultiplier}, 0) AS total_revenue
            FROM \`${baseTable}\` AS l
            LEFT JOIN \`${salesTable}\` AS v ON l.\`#\` = v.cliente_id
            WHERE l.\`${regCol}\` IS NOT NULL
            GROUP BY DATE(l.\`${regCol}\`)
            ORDER BY fecha_reg ASC
        `;
        const [rows] = await pool.query<any[]>(query);
        const mainData = rows.map((r) => {
            const raw = r.fecha_reg;
            const dateStr = raw instanceof Date ? raw.toISOString().slice(0, 10) : raw ? String(raw).slice(0, 10) : '';
            return {
                date: dateStr,
                leads: parseInt(r.total_leads, 10) || 0,
                sales: parseInt(r.total_sales, 10) || 0,
                revenue: parseFloat(r.total_revenue) || 0,
                gasto: 0,
                cpl: 0
            };
        });

        if (!hasAnuncio || !hasSegmentacion) return mainData;

        const adsQuery = `
            SELECT
                DATE(l.\`${regCol}\`) AS fecha_reg,
                COALESCE(l.ANUNCIO, '') AS anuncio,
                COALESCE(l.SEGMENTACION, '') AS segmentacion,
                COUNT(DISTINCT l.\`#\`) AS leads,
                COUNT(DISTINCT v.cliente_id) AS sales,
                COALESCE(SUM(CAST(REPLACE(v.monto, ',', '.') AS DECIMAL(10, 2))) ${revenueMultiplier}, 0) AS revenue
            FROM \`${baseTable}\` AS l
            LEFT JOIN \`${salesTable}\` AS v ON l.\`#\` = v.cliente_id
            WHERE l.\`${regCol}\` IS NOT NULL
            GROUP BY DATE(l.\`${regCol}\`), l.ANUNCIO, l.SEGMENTACION
            ORDER BY fecha_reg ASC, revenue DESC
        `;
        const [adsRows] = await pool.query<any[]>(adsQuery);
        const adsByDate: Record<string, { anuncio: string; segmentacion: string; leads: number; sales: number; revenue: number; gasto: number; roas: number }[]> = {};
        for (const r of adsRows) {
            const raw = r.fecha_reg;
            const dateStr = raw instanceof Date ? raw.toISOString().slice(0, 10) : raw ? String(raw).slice(0, 10) : '';
            if (!adsByDate[dateStr]) adsByDate[dateStr] = [];
            const spendKey = `${normalizeAdName(r.anuncio)}|${normalizeAdName(r.segmentacion)}`;
            const gasto = spendByDate?.[`${dateStr}|${spendKey}`] ?? segmentationsData?.[spendKey]?.spend ?? 0;
            const revenue = parseFloat(r.revenue) || 0;
            const roas = gasto > 0 ? revenue / gasto : 0;
            adsByDate[dateStr].push({
                anuncio: cleanDisplayName(r.anuncio) || 'Sin anuncio',
                segmentacion: cleanDisplayName(r.segmentacion) || 'Sin segmentación',
                leads: parseInt(r.leads, 10) || 0,
                sales: parseInt(r.sales, 10) || 0,
                revenue,
                gasto,
                roas
            });
        }
        const MAX_ADS_PER_DATE = 20;
        return mainData.map((row) => {
            const allAds = adsByDate[row.date] || [];
            const gasto = allAds.reduce((s, a) => s + (a.gasto || 0), 0);
            const cpl = row.leads > 0 ? gasto / row.leads : 0;
            const ads = allAds.slice(0, MAX_ADS_PER_DATE);
            return {
                ...row,
                gasto,
                cpl,
                ads
            };
        });
    } catch (error) {
        console.error('Error getSalesByRegistrationDate:', error);
        return null;
    }
}

async function getCountryColumn(baseTable: string): Promise<string | null> {
    const candidates = ['PAIS', 'COUNTRY', 'PAÍS', 'Pais', 'Country'];
    for (const col of candidates) {
        if (await columnExists(baseTable, col)) return col;
    }
    return null;
}

async function getCampaignColumn(baseTable: string): Promise<string | null> {
    const candidates = ['CAMPAÑA', 'CAMPANA', 'CAMPAIGN', 'Campaign'];
    for (const col of candidates) {
        if (await columnExists(baseTable, col)) return col;
    }
    return null;
}

async function getTrafficTypeSummary(
    baseTable: string,
    salesTable: string,
    multiplyRevenue: boolean
): Promise<{ frio: { leads: number; sales: number; revenue: number }; caliente: { leads: number; sales: number; revenue: number }; otro: { leads: number; sales: number; revenue: number } } | null> {
    const campaignCol = await getCampaignColumn(baseTable);
    if (!campaignCol) return null;

    try {
        const revenueMultiplier = multiplyRevenue ? '* 2' : '';
        const query = `
            SELECT
                CASE
                    WHEN UPPER(COALESCE(l.\`${campaignCol}\`, '')) LIKE '%PQ%' THEN 'caliente'
                    WHEN UPPER(COALESCE(l.\`${campaignCol}\`, '')) LIKE '%PF%' THEN 'frio'
                    ELSE 'otro'
                END AS tipo_trafico,
                COUNT(l.\`#\`) AS leads,
                COUNT(v.cliente_id) AS sales,
                COALESCE(SUM(CAST(REPLACE(v.monto, ',', '.') AS DECIMAL(10, 2))) ${revenueMultiplier}, 0) AS revenue
            FROM \`${baseTable}\` AS l
            LEFT JOIN \`${salesTable}\` AS v ON l.\`#\` = v.cliente_id AND (v.fuente IS NULL OR LOWER(v.fuente) NOT LIKE '%org%')
            WHERE l.ANUNCIO IS NOT NULL AND l.ANUNCIO != '' AND l.SEGMENTACION IS NOT NULL
            GROUP BY tipo_trafico
        `;
        const [rows] = await pool.query<any[]>(query);
        const result = {
            frio: { leads: 0, sales: 0, revenue: 0 },
            caliente: { leads: 0, sales: 0, revenue: 0 },
            otro: { leads: 0, sales: 0, revenue: 0 }
        };
        for (const r of rows) {
            const tipo = String(r.tipo_trafico || 'otro').toLowerCase();
            const key = tipo === 'frio' ? 'frio' : tipo === 'caliente' ? 'caliente' : 'otro';
            result[key] = {
                leads: parseInt(r.leads, 10) || 0,
                sales: parseInt(r.sales, 10) || 0,
                revenue: parseFloat(r.revenue) || 0
            };
        }
        return result;
    } catch (error) {
        console.error('Error getTrafficTypeSummary:', error);
        return null;
    }
}

function getSpendByTrafficType(segmentationsData: Record<string, { campaign_name?: string; spend?: number }>): { frio: number; caliente: number; otro: number } {
    const result = { frio: 0, caliente: 0, otro: 0 };
    for (const seg of Object.values(segmentationsData)) {
        const campaign = String(seg.campaign_name || '').toUpperCase();
        const spend = seg.spend ?? 0;
        if (campaign.includes('PQ')) result.caliente += spend;
        else if (campaign.includes('PF')) result.frio += spend;
        else result.otro += spend;
    }
    return result;
}

async function getSalesByRegistrationDateByTrafficType(
    baseTable: string,
    salesTable: string,
    multiplyRevenue: boolean,
    segmentationsData: Record<string, { campaign_name?: string; spend?: number }>,
    spendByDate?: Record<string, number>
): Promise<{ frio: { date: string; leads: number; sales: number; revenue: number; gasto: number; cpl: number }[]; caliente: { date: string; leads: number; sales: number; revenue: number; gasto: number; cpl: number }[]; otro: { date: string; leads: number; sales: number; revenue: number; gasto: number; cpl: number }[] } | null> {
    const campaignCol = await getCampaignColumn(baseTable);
    const regDateCandidates = ['FECHA_REGISTRO', 'FECHA', 'FECHA_CAPTACION', 'FECHA_REGISTO', 'fecha_registro', 'created_at'];
    const regCol = await getDateColumn(baseTable, regDateCandidates);
    if (!campaignCol || !regCol) return null;

    try {
        const revenueMultiplier = multiplyRevenue ? '* 2' : '';
        const query = `
            SELECT
                DATE(l.\`${regCol}\`) AS fecha_reg,
                CASE
                    WHEN UPPER(COALESCE(l.\`${campaignCol}\`, '')) LIKE '%PQ%' THEN 'caliente'
                    WHEN UPPER(COALESCE(l.\`${campaignCol}\`, '')) LIKE '%PF%' THEN 'frio'
                    ELSE 'otro'
                END AS tipo_trafico,
                COUNT(DISTINCT l.\`#\`) AS leads,
                COUNT(DISTINCT v.cliente_id) AS sales,
                COALESCE(SUM(CAST(REPLACE(v.monto, ',', '.') AS DECIMAL(10, 2))) ${revenueMultiplier}, 0) AS revenue
            FROM \`${baseTable}\` AS l
            LEFT JOIN \`${salesTable}\` AS v ON l.\`#\` = v.cliente_id
            WHERE l.\`${regCol}\` IS NOT NULL
            GROUP BY DATE(l.\`${regCol}\`), tipo_trafico
            ORDER BY fecha_reg ASC, tipo_trafico
        `;
        const [rows] = await pool.query<any[]>(query);
        const byType: Record<string, Record<string, { leads: number; sales: number; revenue: number }>> = { frio: {}, caliente: {}, otro: {} };
        for (const r of rows) {
            const dateStr = r.fecha_reg instanceof Date ? r.fecha_reg.toISOString().slice(0, 10) : String(r.fecha_reg || '').slice(0, 10);
            const tipo = String(r.tipo_trafico || 'otro').toLowerCase();
            const key = tipo === 'frio' ? 'frio' : tipo === 'caliente' ? 'caliente' : 'otro';
            if (!byType[key][dateStr]) byType[key][dateStr] = { leads: 0, sales: 0, revenue: 0 };
            byType[key][dateStr] = {
                leads: parseInt(r.leads, 10) || 0,
                sales: parseInt(r.sales, 10) || 0,
                revenue: parseFloat(r.revenue) || 0
            };
        }
        const spendByDateByTrafficType: Record<string, { frio: number; caliente: number; otro: number }> = {};
        if (spendByDate) {
            for (const [dateKey, amount] of Object.entries(spendByDate)) {
                const parts = dateKey.split('|');
                if (parts.length >= 2) {
                    const dateStr = parts[0];
                    const spendKey = parts.slice(1).join('|');
                    const seg = segmentationsData[spendKey];
                    const campaign = String(seg?.campaign_name || '').toUpperCase();
                    const tipo: 'frio' | 'caliente' | 'otro' = campaign.includes('PQ') ? 'caliente' : campaign.includes('PF') ? 'frio' : 'otro';
                    if (!spendByDateByTrafficType[dateStr]) spendByDateByTrafficType[dateStr] = { frio: 0, caliente: 0, otro: 0 };
                    spendByDateByTrafficType[dateStr][tipo] = (spendByDateByTrafficType[dateStr][tipo] || 0) + amount;
                }
            }
        }
        const buildArray = (tipo: 'frio' | 'caliente' | 'otro') => {
            const dates = new Set([...Object.keys(byType[tipo]), ...Object.keys(spendByDateByTrafficType || {})]);
            return Array.from(dates)
                .sort()
                .map((dateStr) => {
                    const d = byType[tipo][dateStr] || { leads: 0, sales: 0, revenue: 0 };
                    const gasto = spendByDateByTrafficType?.[dateStr]?.[tipo] ?? 0;
                    return {
                        date: dateStr,
                        leads: d.leads,
                        sales: d.sales,
                        revenue: d.revenue,
                        gasto,
                        cpl: d.leads > 0 ? gasto / d.leads : 0
                    };
                });
        };
        return {
            frio: buildArray('frio'),
            caliente: buildArray('caliente'),
            otro: buildArray('otro')
        };
    } catch (error) {
        console.error('Error getSalesByRegistrationDateByTrafficType:', error);
        return null;
    }
}

async function getSalesByCountry(
    baseTable: string,
    salesTable: string,
    multiplyRevenue: boolean
): Promise<{ country: string; tracked_sales: number; organic_sales: number }[] | null> {
    const countryCol = await getCountryColumn(baseTable);
    if (!countryCol) return null;

    try {
        const revenueMultiplier = multiplyRevenue ? '* 2' : '';
        const query = `
            SELECT
                COALESCE(l.\`${countryCol}\`, 'Sin país') AS country,
                COALESCE(SUM(CASE WHEN v.fuente IS NULL OR LOWER(v.fuente) NOT LIKE '%org%' THEN CAST(REPLACE(v.monto, ',', '.') AS DECIMAL(10, 2)) ELSE 0 END) ${revenueMultiplier}, 0) AS tracked_sales,
                COALESCE(SUM(CASE WHEN LOWER(v.fuente) LIKE '%org%' THEN CAST(REPLACE(v.monto, ',', '.') AS DECIMAL(10, 2)) ELSE 0 END) ${revenueMultiplier}, 0) AS organic_sales
            FROM \`${baseTable}\` AS l
            INNER JOIN \`${salesTable}\` AS v ON l.\`#\` = v.cliente_id
            GROUP BY l.\`${countryCol}\`
        `;
        const [rows] = await pool.query<any[]>(query);
        return rows.map((r) => ({
            country: String(r.country || 'Sin país'),
            tracked_sales: parseFloat(r.tracked_sales) || 0,
            organic_sales: parseFloat(r.organic_sales) || 0
        }));
    } catch (error) {
        console.error('Error getSalesByCountry:', error);
        return null;
    }
}

async function getSalesByRegistrationDateByCountry(
    baseTable: string,
    salesTable: string,
    multiplyRevenue: boolean
): Promise<Record<string, { country: string; leads: number; sales: number; revenue: number; gasto: number }[]> | null> {
    const regDateCandidates = ['FECHA_REGISTRO', 'FECHA', 'FECHA_CAPTACION', 'FECHA_REGISTO', 'fecha_registro', 'created_at'];
    const regCol = await getDateColumn(baseTable, regDateCandidates);
    const countryCol = await getCountryColumn(baseTable);
    if (!regCol || !countryCol) return null;

    try {
        const revenueMultiplier = multiplyRevenue ? '* 2' : '';
        const query = `
            SELECT
                DATE(l.\`${regCol}\`) AS fecha_reg,
                COALESCE(l.\`${countryCol}\`, 'Sin país') AS country,
                COUNT(DISTINCT l.\`#\`) AS leads,
                COUNT(DISTINCT v.cliente_id) AS sales,
                COALESCE(SUM(CAST(REPLACE(v.monto, ',', '.') AS DECIMAL(10, 2))) ${revenueMultiplier}, 0) AS revenue
            FROM \`${baseTable}\` AS l
            LEFT JOIN \`${salesTable}\` AS v ON l.\`#\` = v.cliente_id
            WHERE l.\`${regCol}\` IS NOT NULL
            GROUP BY DATE(l.\`${regCol}\`), l.\`${countryCol}\`
            ORDER BY fecha_reg ASC, revenue DESC
        `;
        const [rows] = await pool.query<any[]>(query);
        const byDate: Record<string, { country: string; leads: number; sales: number; revenue: number; gasto: number }[]> = {};
        for (const r of rows) {
            const raw = r.fecha_reg;
            const dateStr = raw instanceof Date ? raw.toISOString().slice(0, 10) : raw ? String(raw).slice(0, 10) : '';
            const country = String(r.country || 'Sin país').trim();
            if (!byDate[dateStr]) byDate[dateStr] = [];
            byDate[dateStr].push({
                country,
                leads: parseInt(r.leads, 10) || 0,
                sales: parseInt(r.sales, 10) || 0,
                revenue: parseFloat(r.revenue) || 0,
                gasto: 0
            });
        }
        return byDate;
    } catch (error) {
        console.error('Error getSalesByRegistrationDateByCountry:', error);
        return null;
    }
}

async function getOrganicSales(salesTable: string, multiplyRevenue = false) {
    try {
        const revenueMultiplier = multiplyRevenue ? '* 2' : '';
        const query = `
      SELECT
          COUNT(venta_id) AS total_sales,
          COALESCE(SUM(CAST(REPLACE(monto, ',', '.') AS DECIMAL(10, 2))) ${revenueMultiplier}, 0) AS total_revenue
      FROM \`${salesTable}\`
      WHERE LOWER(fuente) LIKE '%org%'
    `;
        const [rows] = await pool.query<any[]>(query);
        return rows[0] || null;
    } catch (error) {
        console.error('Error getOrganicSales:', error);
        return null;
    }
}

async function getQualityLeadData(baseTable: string, salesTable: string, multiplyRevenue = false) {
    try {
        const hasAdId = await columnExists(baseTable, 'AD_ID');
        const hasQlead = await columnExists(baseTable, 'QLEAD');
        const hasIngresos = await columnExists(baseTable, 'INGRESOS');
        const hasEstudios = await columnExists(baseTable, 'ESTUDIOS');
        const hasOcupacion = await columnExists(baseTable, 'OCUPACION');
        const hasProposito = await columnExists(baseTable, 'PROPOSITO');
        const hasEdadEspecifica = await columnExists(baseTable, 'EDAD_ESPECIFICA');
        const hasPuntaje = await columnExists(baseTable, 'PUNTAJE');

        const revenueMultiplier = multiplyRevenue ? '* 2' : '';
        const adIdSelect = hasAdId ? "COALESCE(l.AD_ID, '') AS AD_ID" : "' ' AS AD_ID";

        const qualityColumns = [];
        const groupByColumns = ['l.ANUNCIO', 'l.SEGMENTACION', 'l.CAMPAÑA'];

        if (hasAdId) groupByColumns.push('l.AD_ID');
        if (hasQlead) { qualityColumns.push('l.QLEAD'); groupByColumns.push('l.QLEAD'); }
        if (hasIngresos) { qualityColumns.push('l.INGRESOS'); groupByColumns.push('l.INGRESOS'); }
        if (hasEstudios) { qualityColumns.push('l.ESTUDIOS'); groupByColumns.push('l.ESTUDIOS'); }
        if (hasOcupacion) { qualityColumns.push('l.OCUPACION'); groupByColumns.push('l.OCUPACION'); }
        if (hasProposito) { qualityColumns.push('l.PROPOSITO'); groupByColumns.push('l.PROPOSITO'); }
        if (hasEdadEspecifica) { qualityColumns.push('l.EDAD_ESPECIFICA'); groupByColumns.push('l.EDAD_ESPECIFICA'); }
        if (hasPuntaje) { qualityColumns.push('l.PUNTAJE'); groupByColumns.push('l.PUNTAJE'); }

        const qualityColumnsSql = qualityColumns.join(',\n                ');
        const groupByClause = groupByColumns.join(', ');

        const query = `
      SELECT
          l.ANUNCIO,
          l.SEGMENTACION,
          l.CAMPAÑA,
          ${adIdSelect}
          ${qualityColumns.length > 0 ? `,\n                ${qualityColumnsSql},` : ','}
          COUNT(l.\`#\`) AS total_leads,
          COUNT(v.cliente_id) AS total_sales,
          COALESCE(SUM(CAST(REPLACE(v.monto, ',', '.') AS DECIMAL(10, 2))) ${revenueMultiplier}, 0) AS total_revenue
      FROM \`${baseTable}\` AS l
      LEFT JOIN \`${salesTable}\` AS v ON l.\`#\` = v.cliente_id AND (v.fuente IS NULL OR LOWER(v.fuente) NOT LIKE '%org%')
      WHERE l.ANUNCIO IS NOT NULL AND l.ANUNCIO != '' AND l.SEGMENTACION IS NOT NULL
      GROUP BY ${groupByClause};
    `;

        const [rows] = await pool.query<any[]>(query);
        return rows.map(row => ({
            ...row,
            ANUNCIO_NORMALIZED: normalizeAdName(row.ANUNCIO),
            SEGMENTACION_NORMALIZED: normalizeAdName(row.SEGMENTACION),
        }));
    } catch (error) {
        console.error('Database Error getQualityLeadData:', error);
        return null;
    }
}

function findMatchingAdKey(segData: any, ads: any) {
    if (segData.ad_id) {
        for (const [adKey, adData] of Object.entries<any>(ads)) {
            for (const seg of adData.segmentations) {
                if (seg.ad_id && seg.ad_id === segData.ad_id) {
                    return adKey;
                }
            }
        }
    }
    return segData.ad_name_normalized;
}

export async function processDashboardData(formData: FormData) {
    const baseTable = formData.get('base_table') as string;
    const salesTable = formData.get('sales_table') as string;
    const multiplyRevenue = formData.get('multiply_revenue') === '1';
    const exchangeRate = parseFloat((formData.get('exchange_rate') as string) || '0');
    const csvFile = formData.get('spend_report') as File;
    const countryCsvFile = formData.get('country_report') as File | null;

    if (!baseTable || !salesTable) {
        throw new Error('Debes seleccionar tanto la tabla base como la tabla de ventas.');
    }

    if (!csvFile || csvFile.size === 0) {
        throw new Error('CSV es requerido');
    }

    const csvContent = await csvFile.text();
    const spendResult = await processSpendCSV(csvContent, exchangeRate);

    const segmentationsData = spendResult.segmentations;
    const spendMapping = spendResult.mapping;
    const spendByDate = spendResult.spendByDate;

    if (Object.keys(segmentationsData).length === 0) {
        throw new Error('No se pudieron procesar los datos de gastos del archivo CSV.');
    }

    const revenueData = await getRevenueData(baseTable, salesTable, multiplyRevenue);
    const organicSalesData = await getOrganicSales(salesTable, multiplyRevenue);

    // buildInteractiveData Logic
    const ads: Record<string, any> = {};

    if (organicSalesData && organicSalesData.total_sales > 0) {
        ads['organica'] = {
            ad_name_display: 'Orgánica',
            total_revenue: parseFloat(organicSalesData.total_revenue),
            total_leads: 0,
            total_sales: parseInt(organicSalesData.total_sales, 10),
            total_spend: 0,
            roas: 0,
            profit: parseFloat(organicSalesData.total_revenue),
            segmentations: [{
                name: 'Orgánica',
                campaign_name: 'Orgánica',
                ad_id: '',
                revenue: parseFloat(organicSalesData.total_revenue),
                leads: 0,
                sales: parseInt(organicSalesData.total_sales, 10),
                spend_allocated: 0,
                profit: parseFloat(organicSalesData.total_revenue),
                cpl: 0,
                conversion_rate: 0
            }]
        };
    }

    if (revenueData) {
        for (const revItem of revenueData) {
            const adNameOriginal = revItem.ANUNCIO;
            const adNameNormalized = revItem.ANUNCIO_NORMALIZED;
            const segmentationOriginal = revItem.SEGMENTACION;
            const segmentationNormalized = revItem.SEGMENTACION_NORMALIZED;
            const campaignName = revItem.CAMPAÑA || '';
            const revenue = parseFloat(revItem.total_revenue);
            const leads = parseInt(revItem.total_leads, 10);
            const sales = parseInt(revItem.total_sales, 10);

            if (!ads[adNameNormalized]) {
                const displayName = spendMapping[adNameNormalized]
                    ? cleanDisplayName(spendMapping[adNameNormalized])
                    : cleanDisplayName(adNameOriginal);

                ads[adNameNormalized] = {
                    ad_name_display: displayName,
                    total_revenue: 0,
                    total_leads: 0,
                    total_sales: 0,
                    total_spend: 0,
                    roas: 0,
                    segmentations: []
                };
            }

            let segFound = false;
            for (const existingSeg of ads[adNameNormalized].segmentations) {
                if (normalizeAdName(existingSeg.name) === segmentationNormalized) {
                    const uniqueBdKey = `${adNameNormalized}|${segmentationNormalized}|${revenue}|${leads}`;
                    existingSeg.processed_bd_keys = existingSeg.processed_bd_keys || [];

                    if (!existingSeg.processed_bd_keys.includes(uniqueBdKey)) {
                        existingSeg.revenue += revenue;
                        existingSeg.leads += leads;
                        existingSeg.sales += sales;
                        existingSeg.processed_bd_keys.push(uniqueBdKey);
                    }
                    existingSeg.campaign_name = campaignName;
                    existingSeg.conversion_rate = existingSeg.leads > 0 ? (existingSeg.sales / existingSeg.leads) * 100 : 0;
                    segFound = true;
                    break;
                }
            }

            if (!segFound) {
                ads[adNameNormalized].segmentations.push({
                    name: cleanDisplayName(segmentationOriginal),
                    campaign_name: campaignName,
                    ad_id: revItem.AD_ID || '',
                    revenue,
                    leads,
                    sales,
                    spend_allocated: 0,
                    profit: revenue,
                    cpl: 0,
                    conversion_rate: leads > 0 ? (sales / leads) * 100 : 0
                });
            }

            ads[adNameNormalized].total_revenue += revenue;
            ads[adNameNormalized].total_leads += leads;
            ads[adNameNormalized].total_sales += sales;
        }
    }

    // Assign Spends
    for (const segData of Object.values(segmentationsData)) {
        const adNameNormalized = segData.ad_name_normalized;
        const segmentationName = segData.segmentation_name;
        const segmentationNormalized = normalizeAdName(segmentationName);
        const spend = segData.spend;
        const adIdFromCsv = segData.ad_id;

        const matchingAdKey = findMatchingAdKey(segData, ads);

        if (ads[matchingAdKey]) {
            let segFound = false;
            for (const existingSeg of ads[matchingAdKey].segmentations) {
                if (adIdFromCsv && existingSeg.ad_id && adIdFromCsv === existingSeg.ad_id) {
                    existingSeg.spend_allocated += spend;
                    existingSeg.profit = existingSeg.revenue - existingSeg.spend_allocated;
                    existingSeg.cpl = existingSeg.leads > 0 ? existingSeg.spend_allocated / existingSeg.leads : 0;
                    segFound = true;
                    break;
                } else if (normalizeAdName(existingSeg.name) === segmentationNormalized) {
                    existingSeg.spend_allocated += spend;
                    existingSeg.profit = existingSeg.revenue - existingSeg.spend_allocated;
                    existingSeg.cpl = existingSeg.leads > 0 ? existingSeg.spend_allocated / existingSeg.leads : 0;
                    segFound = true;
                    break;
                }
            }

            if (!segFound) {
                ads[matchingAdKey].segmentations.push({
                    name: cleanDisplayName(segmentationName),
                    campaign_name: segData.campaign_name,
                    ad_id: adIdFromCsv,
                    revenue: 0,
                    leads: 0,
                    sales: 0,
                    spend_allocated: spend,
                    profit: -spend,
                    cpl: 0,
                    conversion_rate: 0
                });
            }

            ads[matchingAdKey].total_spend += spend;
        } else {
            ads[adNameNormalized] = {
                ad_name_display: cleanDisplayName(segData.ad_name_original),
                total_revenue: 0,
                total_leads: 0,
                total_sales: 0,
                total_spend: spend,
                roas: 0,
                segmentations: [{
                    name: cleanDisplayName(segmentationName),
                    campaign_name: segData.campaign_name,
                    ad_id: adIdFromCsv,
                    revenue: 0,
                    leads: 0,
                    sales: 0,
                    spend_allocated: spend,
                    profit: -spend,
                    cpl: 0,
                    conversion_rate: 0
                }]
            };
        }
    }

    // Calculate ROAS and general utility
    let totalRevenueAll = 0;
    let totalSpendAll = 0;

    for (const [adKey, adData] of Object.entries<any>(ads)) {
        adData.total_spend = parseFloat(Number(adData.total_spend).toFixed(2));
        adData.total_revenue = parseFloat(Number(adData.total_revenue).toFixed(2));
        if (adData.total_spend > 0) {
            adData.roas = adData.total_revenue / adData.total_spend;
        } else {
            adData.roas = 0;
        }
        adData.profit = adData.total_revenue - adData.total_spend;

        if (adKey !== 'organica') {
            totalRevenueAll += adData.total_revenue;
        }
        totalSpendAll += adData.total_spend;

        for (const seg of adData.segmentations) {
            if (seg.profit === undefined || seg.profit === null) {
                seg.profit = seg.revenue - (seg.spend_allocated || 0);
            }
            if (seg.cpl === undefined || seg.cpl === null) {
                seg.cpl = (seg.leads > 0 && (seg.spend_allocated || 0) > 0) ? (seg.spend_allocated || 0) / seg.leads : 0;
            }
        }

        adData.segmentations.sort((a: any, b: any) => b.revenue - a.revenue);
    }

    // Sort Ads
    const sortedAds = Object.entries(ads).sort((a: any, b: any) => b[1].profit - a[1].profit);

    const qualityLeadData = await getQualityLeadData(baseTable, salesTable, multiplyRevenue);
    const qualityData = qualityLeadData
        ? buildQualityAnalysis(qualityLeadData, segmentationsData, multiplyRevenue)
        : null;

    const captationDaysData = await getPurchasesByDaysSinceRegistration(baseTable, salesTable, multiplyRevenue);
    const salesByRegistrationDate = await getSalesByRegistrationDate(baseTable, salesTable, multiplyRevenue, segmentationsData, spendByDate);

    const trafficTypeSummary = await getTrafficTypeSummary(baseTable, salesTable, multiplyRevenue);
    const trafficTypeSpend = getSpendByTrafficType(segmentationsData);
    const captationByTrafficType = trafficTypeSummary
        ? await getSalesByRegistrationDateByTrafficType(baseTable, salesTable, multiplyRevenue, segmentationsData, spendByDate)
        : null;

    let countryData: { country: string; gasto: number; roas: number; ventas_organicas: number; ventas_trackeadas: number }[] | null = null;

    let salesByRegistrationDateByCountry: Record<string, { country: string; leads: number; sales: number; revenue: number; gasto: number }[]> | null = null;

    if (countryCsvFile && countryCsvFile.size > 0) {
        const countryCsvContent = await countryCsvFile.text();
        const { byCountry: spendByCountry, spendByDateAndCountry } = await processCountryCSV(countryCsvContent, exchangeRate);
        const salesByCountry = await getSalesByCountry(baseTable, salesTable, multiplyRevenue);

        const allCountries = new Set<string>([
            ...Object.keys(spendByCountry),
            ...(salesByCountry || []).map((r) => r.country)
        ]);

        countryData = Array.from(allCountries).map((country) => {
            const gasto = spendByCountry[country] || 0;
            const salesRow = salesByCountry?.find((r) => r.country === country);
            const ventas_trackeadas = salesRow?.tracked_sales ?? 0;
            const ventas_organicas = salesRow?.organic_sales ?? 0;
            const roas = gasto > 0 ? ventas_trackeadas / gasto : 0;
            return {
                country,
                gasto,
                roas,
                ventas_organicas,
                ventas_trackeadas
            };
        });

        countryData.sort((a, b) => b.gasto - a.gasto);

        const byCountryRaw = await getSalesByRegistrationDateByCountry(baseTable, salesTable, multiplyRevenue);
        if (byCountryRaw && spendByDateAndCountry) {
            salesByRegistrationDateByCountry = {};
            for (const [dateStr, countries] of Object.entries(byCountryRaw)) {
                salesByRegistrationDateByCountry[dateStr] = countries.map((c) => {
                    const gasto = spendByDateAndCountry[dateStr]?.[c.country] ?? 0;
                    return { ...c, gasto };
                });
            }
        } else if (byCountryRaw) {
            salesByRegistrationDateByCountry = byCountryRaw;
        }
    }

    const captationByAnuncio: Record<string, { date: string; leads: number; sales: number; revenue: number; gasto: number; cpl: number; ads?: { anuncio: string; segmentacion: string; leads: number; sales: number; revenue: number; gasto: number }[] }[]> = {};
    const captationBySegmentacion: Record<string, { date: string; leads: number; sales: number; revenue: number; gasto: number; cpl: number; ads?: { anuncio: string; segmentacion: string; leads: number; sales: number; revenue: number; gasto: number }[] }[]> = {};
    const captationByPais: Record<string, { date: string; leads: number; sales: number; revenue: number; gasto: number; cpl: number }[]> = {};

    if (salesByRegistrationDate && Array.isArray(salesByRegistrationDate)) {
        for (const row of salesByRegistrationDate) {
            const dateStr = row.date;
            for (const ad of row.ads || []) {
                const anuncio = ad.anuncio || 'Sin anuncio';
                const segmentacion = ad.segmentacion || 'Sin segmentación';
                const leads = ad.leads || 0;
                const sales = ad.sales || 0;
                const revenue = ad.revenue || 0;
                const gasto = ad.gasto || 0;
                if (!captationByAnuncio[anuncio]) captationByAnuncio[anuncio] = [];
                if (!captationBySegmentacion[segmentacion]) captationBySegmentacion[segmentacion] = [];
                const aggAnuncio = captationByAnuncio[anuncio];
                const aggSeg = captationBySegmentacion[segmentacion];
                let foundAn = aggAnuncio.find((x) => x.date === dateStr);
                let foundSeg = aggSeg.find((x) => x.date === dateStr);
                const adEntry = { anuncio: ad.anuncio || 'Sin anuncio', segmentacion: ad.segmentacion || 'Sin segmentación', leads: ad.leads || 0, sales: ad.sales || 0, revenue: ad.revenue || 0, gasto: ad.gasto || 0 };
                if (!foundAn) {
                    foundAn = { date: dateStr, leads: 0, sales: 0, revenue: 0, gasto: 0, cpl: 0, ads: [] };
                    aggAnuncio.push(foundAn);
                }
                if (!foundSeg) {
                    foundSeg = { date: dateStr, leads: 0, sales: 0, revenue: 0, gasto: 0, cpl: 0, ads: [] };
                    aggSeg.push(foundSeg);
                }
                foundAn.leads += leads;
                foundAn.sales += sales;
                foundAn.revenue += revenue;
                foundAn.gasto += gasto;
                (foundAn.ads as any[]).push(adEntry);
                foundSeg.leads += leads;
                foundSeg.sales += sales;
                foundSeg.revenue += revenue;
                foundSeg.gasto += gasto;
                (foundSeg.ads as any[]).push(adEntry);
            }
        }
        for (const arr of Object.values(captationByAnuncio)) {
            arr.sort((a, b) => a.date.localeCompare(b.date));
            for (const r of arr) r.cpl = r.leads > 0 ? r.gasto / r.leads : 0;
        }
        for (const arr of Object.values(captationBySegmentacion)) {
            arr.sort((a, b) => a.date.localeCompare(b.date));
            for (const r of arr) r.cpl = r.leads > 0 ? r.gasto / r.leads : 0;
        }
    }

    if (salesByRegistrationDateByCountry) {
        const allDates = new Set<string>(Object.keys(salesByRegistrationDateByCountry));
        if (salesByRegistrationDate) for (const r of salesByRegistrationDate) allDates.add(r.date);
        for (const dateStr of Array.from(allDates).sort()) {
            const countries = salesByRegistrationDateByCountry[dateStr] || [];
            for (const c of countries) {
                const country = c.country || 'Sin país';
                const gasto = c.gasto ?? 0;
                const cpl = c.leads > 0 ? gasto / c.leads : 0;
                if (!captationByPais[country]) captationByPais[country] = [];
                captationByPais[country].push({
                    date: dateStr,
                    leads: c.leads,
                    sales: c.sales,
                    revenue: c.revenue,
                    gasto,
                    cpl
                });
            }
        }
        for (const arr of Object.values(captationByPais)) arr.sort((a, b) => a.date.localeCompare(b.date));
    }

    return {
        ads: Object.fromEntries(sortedAds),
        summary: {
            totalRevenueAll,
            totalSpendAll,
            totalRoasAll: totalSpendAll > 0 ? totalRevenueAll / totalSpendAll : 0,
            multiply_revenue: multiplyRevenue
        },
        qualityData,
        countryData,
        captationDaysData,
        salesByRegistrationDate,
        salesByRegistrationDateByCountry,
        captationByAnuncio,
        captationBySegmentacion,
        captationByPais,
        trafficTypeSummary,
        trafficTypeSpend,
        captationByTrafficType
    };
}
