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
    multiplyRevenue: boolean
): Promise<{ date: string; leads: number; sales: number; revenue: number }[] | null> {
    const regDateCandidates = ['FECHA_REGISTRO', 'FECHA', 'FECHA_CAPTACION', 'FECHA_REGISTO', 'fecha_registro', 'created_at'];
    const regCol = await getDateColumn(baseTable, regDateCandidates);
    if (!regCol) return null;

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
        return rows.map((r) => {
            const raw = r.fecha_reg;
            const dateStr = raw instanceof Date ? raw.toISOString().slice(0, 10) : raw ? String(raw).slice(0, 10) : '';
            return {
            date: dateStr,
            leads: parseInt(r.total_leads, 10) || 0,
            sales: parseInt(r.total_sales, 10) || 0,
            revenue: parseFloat(r.total_revenue) || 0
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
    const salesByRegistrationDate = await getSalesByRegistrationDate(baseTable, salesTable, multiplyRevenue);

    let countryData: { country: string; gasto: number; roas: number; ventas_organicas: number; ventas_trackeadas: number }[] | null = null;

    if (countryCsvFile && countryCsvFile.size > 0) {
        const countryCsvContent = await countryCsvFile.text();
        const spendByCountry = await processCountryCSV(countryCsvContent, exchangeRate);
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
        salesByRegistrationDate
    };
}
