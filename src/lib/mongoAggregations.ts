'use server';

import { ObjectId } from 'mongodb';
import { getMongoDb } from '@/lib/mongodb';
import { cleanDisplayName, normalizeAdName, SpendSegmentation } from '@/lib/utils/csvProcessor';

const configId = (base: string, sales: string) => `${base}|${sales}`;

export interface AdSegment {
    name: string;
    campaign_name: string;
    ad_id: string;
    revenue: number;
    leads: number;
    sales: number;
    spend_allocated: number;
    profit: number;
    cpl: number;
    conversion_rate: number;
}

export interface AdData {
    ad_name_display: string;
    total_revenue: number;
    total_leads: number;
    total_sales: number;
    total_spend: number;
    roas: number;
    profit: number;
    segmentations: AdSegment[];
}

export async function aggregateAdsFromMongo(
    baseTable: string,
    salesTable: string,
    reportId: ObjectId,
    multiplyRevenue: boolean,
    spendMapping: Record<string, string>
): Promise<Record<string, AdData>> {
    const cfg = configId(baseTable, salesTable);
    const db = await getMongoDb();
    const leadsCol = db.collection('leads');
    const revenueMult = multiplyRevenue ? 2 : 1;

    const pipeline = [
        { $match: { config_id: cfg, anuncio_normalized: { $ne: '' }, segmentacion_normalized: { $ne: '' } } },
        {
            $lookup: {
                from: 'sales',
                let: { cid: '$cliente_id' },
                pipeline: [
                    {
                        $match: {
                            $expr: { $eq: ['$cliente_id', '$$cid'] },
                            config_id: cfg,
                            $or: [
                                { fuente: { $exists: false } },
                                { fuente: '' },
                                { fuente: { $not: { $regex: /org/i } } }
                            ]
                        }
                    },
                    { $group: { _id: null, cnt: { $sum: 1 }, rev: { $sum: { $multiply: ['$monto', multiplyRevenue ? 2 : 1] } } } }
                ],
                as: 'sales_agg'
            }
        },
        {
            $addFields: {
                total_sales: { $ifNull: [{ $arrayElemAt: ['$sales_agg.cnt', 0] }, 0] },
                total_revenue: { $ifNull: [{ $arrayElemAt: ['$sales_agg.rev', 0] }, 0] }
            }
        },
        {
            $group: {
                _id: { an: '$anuncio_normalized', seg: '$segmentacion_normalized', campana: '$campana', ad_id: '$ad_id', an_orig: '$anuncio', seg_orig: '$segmentacion' },
                total_leads: { $sum: 1 },
                total_sales: { $sum: '$total_sales' },
                total_revenue: { $sum: '$total_revenue' }
            }
        }
    ];

    const cursor = leadsCol.aggregate(pipeline as object[], { allowDiskUse: true });
    const revenueRows: { ad: string; seg: string; campana: string; ad_id: string; an_orig: string; seg_orig: string; leads: number; sales: number; revenue: number }[] = [];
    for await (const doc of cursor) {
        revenueRows.push({
            ad: doc._id.an,
            seg: doc._id.seg,
            campana: doc._id.campana || '',
            ad_id: doc._id.ad_id || '',
            an_orig: doc._id.an_orig || '',
            seg_orig: doc._id.seg_orig || '',
            leads: doc.total_leads,
            sales: doc.total_sales,
            revenue: doc.total_revenue
        });
    }

    const spendCol = db.collection('spend_data');
    const spendCursor = spendCol.aggregate([
        { $match: { report_id: reportId, is_daily: { $ne: true } } },
        {
            $group: {
                _id: { ad: '$ad_name_normalized', seg: '$segmentation_normalized' },
                spend: { $sum: '$amount_spent' },
                campaign_name: { $first: '$campaign_name' },
                ad_id: { $first: '$ad_id' }
            }
        }
    ]);

    const spendMap: Record<string, { spend: number; campaign: string; ad_id: string }> = {};
    for await (const doc of spendCursor) {
        const key = `${doc._id.ad}|${doc._id.seg}`;
        spendMap[key] = { spend: doc.spend, campaign: doc.campaign_name || '', ad_id: doc.ad_id || '' };
    }

    const ads: Record<string, AdData> = {};

    for (const r of revenueRows) {
        const key = r.ad;
        const segKey = `${r.ad}|${r.seg}`;
        const spendInfo = spendMap[segKey];
        const spend = spendInfo?.spend ?? 0;
        const displayName = spendMapping[r.ad] ? cleanDisplayName(spendMapping[r.ad]) : cleanDisplayName(r.an_orig);

        if (!ads[key]) {
            ads[key] = {
                ad_name_display: displayName,
                total_revenue: 0,
                total_leads: 0,
                total_sales: 0,
                total_spend: 0,
                roas: 0,
                profit: 0,
                segmentations: []
            };
        }

        const convRate = r.leads > 0 ? (r.sales / r.leads) * 100 : 0;
        const profit = r.revenue - spend;
        const cpl = r.leads > 0 ? spend / r.leads : 0;

        let segFound = false;
        for (const s of ads[key].segmentations) {
            if (normalizeAdName(s.name) === r.seg) {
                s.revenue += r.revenue;
                s.leads += r.leads;
                s.sales += r.sales;
                s.spend_allocated += spend;
                s.profit = s.revenue - s.spend_allocated;
                s.cpl = s.leads > 0 ? s.spend_allocated / s.leads : 0;
                s.conversion_rate = s.leads > 0 ? (s.sales / s.leads) * 100 : 0;
                segFound = true;
                break;
            }
        }
        if (!segFound) {
            ads[key].segmentations.push({
                name: cleanDisplayName(r.seg_orig),
                campaign_name: r.campana || spendInfo?.campaign || '',
                ad_id: r.ad_id || spendInfo?.ad_id || '',
                revenue: r.revenue,
                leads: r.leads,
                sales: r.sales,
                spend_allocated: spend,
                profit,
                cpl,
                conversion_rate: convRate
            });
        }

        ads[key].total_revenue += r.revenue;
        ads[key].total_leads += r.leads;
        ads[key].total_sales += r.sales;
        ads[key].total_spend += spend;
    }

    for (const adData of Object.values(ads)) {
        adData.segmentations.sort((a, b) => b.revenue - a.revenue);
    }

    for (const [segKey, info] of Object.entries(spendMap)) {
        const parts = segKey.split('|');
        const adNorm = parts[0] || '';
        const segNorm = parts.slice(1).join('|') || '';
        if (!adNorm) continue;
        if (!ads[adNorm]) {
            ads[adNorm] = {
                ad_name_display: cleanDisplayName(spendMapping[adNorm] || adNorm),
                total_revenue: 0,
                total_leads: 0,
                total_sales: 0,
                total_spend: 0,
                roas: 0,
                profit: 0,
                segmentations: []
            };
        }
        const hasSeg = ads[adNorm].segmentations.some((s) => normalizeAdName(s.name) === segNorm);
        if (!hasSeg) {
            ads[adNorm].segmentations.push({
                name: segNorm,
                campaign_name: info.campaign,
                ad_id: info.ad_id,
                revenue: 0,
                leads: 0,
                sales: 0,
                spend_allocated: info.spend,
                profit: -info.spend,
                cpl: 0,
                conversion_rate: 0
            });
            ads[adNorm].total_spend += info.spend;
            ads[adNorm].profit -= info.spend;
        }
    }

    for (const ad of Object.values(ads)) {
        ad.total_spend = parseFloat(Number(ad.total_spend).toFixed(2));
        ad.roas = ad.total_spend > 0 ? ad.total_revenue / ad.total_spend : 0;
        ad.profit = ad.total_revenue - ad.total_spend;
    }

    return ads;
}

// --- Organic sales desde MongoDB ---
export async function getOrganicSalesFromMongo(
    configId: string,
    multiplyRevenue: boolean
): Promise<{ total_sales: number; total_revenue: number } | null> {
    const db = await getMongoDb();
    const col = db.collection('sales');
    const mult = multiplyRevenue ? 2 : 1;
    const [r] = await col.aggregate([
        { $match: { config_id: configId, fuente: { $regex: /org/i } } },
        { $group: { _id: null, cnt: { $sum: 1 }, rev: { $sum: { $multiply: ['$monto', mult] } } } }
    ]).toArray();
    if (!r) return null;
    return { total_sales: r.cnt, total_revenue: r.rev };
}

// --- Captation days (días desde registro hasta venta) ---
export async function getPurchasesByDaysSinceRegistrationFromMongo(
    configId: string,
    multiplyRevenue: boolean
): Promise<{ days: number; count: number; revenue: number }[] | null> {
    const db = await getMongoDb();
    const leadsCol = db.collection('leads');
    const mult = multiplyRevenue ? 2 : 1;

    const cursor = leadsCol.aggregate([
        { $match: { config_id: configId, fecha_registro: { $exists: true, $ne: null } } },
        {
            $lookup: {
                from: 'sales',
                let: { cid: '$cliente_id' },
                pipeline: [
                    { $match: { $expr: { $eq: ['$cliente_id', '$$cid'] }, config_id: configId, fecha: { $exists: true, $ne: null } } },
                    { $project: { fecha: 1, monto: 1 } }
                ],
                as: 'sales'
            }
        },
        { $unwind: '$sales' },
        {
            $addFields: {
                days_since_reg: {
                    $floor: { $divide: [{ $subtract: ['$sales.fecha', '$fecha_registro'] }, 86400000] }
                }
            }
        },
        { $match: { days_since_reg: { $gte: 0 } } },
        {
            $group: {
                _id: '$days_since_reg',
                sale_count: { $sum: 1 },
                total_revenue: { $sum: { $multiply: ['$sales.monto', mult] } }
            }
        },
        { $sort: { _id: 1 } }
    ] as object[], { allowDiskUse: true });

    const rows: { days: number; count: number; revenue: number }[] = [];
    for await (const doc of cursor) {
        rows.push({
            days: doc._id,
            count: doc.sale_count,
            revenue: doc.total_revenue
        });
    }
    return rows.length > 0 ? rows : null;
}

// --- Sales by registration date (optimizado: 1 $lookup + $facet en vez de 2 pipelines) ---
export async function getSalesByRegistrationDateFromMongo(
    configId: string,
    reportId: ObjectId,
    multiplyRevenue: boolean
): Promise<{ date: string; leads: number; sales: number; revenue: number; gasto: number; cpl: number; ads?: { anuncio: string; segmentacion: string; leads: number; sales: number; revenue: number; gasto: number; roas: number }[] }[] | null> {
    const db = await getMongoDb();
    const leadsCol = db.collection('leads');
    const spendCol = db.collection('spend_data');
    const mult = multiplyRevenue ? 2 : 1;

    const [spendDailyResult, spendTotalResult, facetResult] = await Promise.all([
        spendCol.aggregate([
            { $match: { report_id: reportId, is_daily: true } },
            { $group: { _id: { day: { $dateToString: { format: '%Y-%m-%d', date: '$day' } }, ad: '$ad_name_normalized', seg: '$segmentation_normalized' }, amount: { $sum: '$amount_spent' } } }
        ]).toArray(),
        spendCol.aggregate([
            { $match: { report_id: reportId, is_daily: { $ne: true } } },
            { $group: { _id: { ad: '$ad_name_normalized', seg: '$segmentation_normalized' }, amount: { $sum: '$amount_spent' } } }
        ]).toArray(),
        leadsCol.aggregate([
            { $match: { config_id: configId, fecha_registro: { $exists: true, $ne: null } } },
            { $addFields: { fecha_str: { $dateToString: { format: '%Y-%m-%d', date: '$fecha_registro' } } } },
            {
                $lookup: {
                    from: 'sales',
                    let: { cid: '$cliente_id' },
                    pipeline: [
                        { $match: { $expr: { $eq: ['$cliente_id', '$$cid'] }, config_id: configId } },
                        { $group: { _id: null, cnt: { $sum: 1 }, rev: { $sum: { $multiply: ['$monto', mult] } } } }
                    ],
                    as: 's'
                }
            },
            {
                $facet: {
                    main: [
                        {
                            $group: {
                                _id: '$fecha_str',
                                total_leads: { $sum: 1 },
                                total_sales: { $sum: { $ifNull: [{ $arrayElemAt: ['$s.cnt', 0] }, 0] } },
                                total_revenue: { $sum: { $ifNull: [{ $arrayElemAt: ['$s.rev', 0] }, 0] } }
                            }
                        },
                        { $sort: { _id: 1 } }
                    ],
                    ads: [
                        { $match: { anuncio_normalized: { $ne: '' } } },
                        {
                            $group: {
                                _id: { fecha: '$fecha_str', an: '$anuncio', seg: '$segmentacion' },
                                leads: { $sum: 1 },
                                sales: { $sum: { $ifNull: [{ $arrayElemAt: ['$s.cnt', 0] }, 0] } },
                                revenue: { $sum: { $ifNull: [{ $arrayElemAt: ['$s.rev', 0] }, 0] } }
                            }
                        }
                    ]
                }
            },
            { $limit: 1 }
        ] as object[], { allowDiskUse: true }).next()
    ]);

    const spendByDate: Record<string, number> = {};
    for (const d of spendDailyResult) {
        spendByDate[`${d._id.day}|${d._id.ad}|${d._id.seg}`] = d.amount;
    }
    const spendByAdSeg: Record<string, number> = {};
    for (const d of spendTotalResult) {
        spendByAdSeg[`${d._id.ad}|${d._id.seg}`] = d.amount;
    }

    const mainData = (facetResult?.main || []).map((doc: { _id: string; total_leads: number; total_sales: number; total_revenue: number }) => ({
        date: doc._id,
        leads: doc.total_leads,
        sales: doc.total_sales,
        revenue: doc.total_revenue,
        gasto: 0,
        cpl: 0
    }));

    const adsByDate: Record<string, { anuncio: string; segmentacion: string; leads: number; sales: number; revenue: number; gasto: number; roas: number }[]> = {};
    for (const doc of facetResult?.ads || []) {
        const dateStr = doc._id.fecha;
        const anuncio = doc._id.an || 'Sin anuncio';
        const segmentacion = doc._id.seg || 'Sin segmentación';
        const adSegKey = `${normalizeAdName(anuncio)}|${normalizeAdName(segmentacion)}`;
        const gastoKey = `${dateStr}|${adSegKey}`;
        const gasto = spendByDate[gastoKey] ?? spendByAdSeg[adSegKey] ?? 0;
        const rev = doc.revenue || 0;
        const roas = gasto > 0 ? rev / gasto : 0;
        if (!adsByDate[dateStr]) adsByDate[dateStr] = [];
        adsByDate[dateStr].push({
            anuncio: cleanDisplayName(anuncio),
            segmentacion: cleanDisplayName(segmentacion),
            leads: doc.leads,
            sales: doc.sales,
            revenue: rev,
            gasto,
            roas
        });
    }

    return mainData.map((row: { date: string; leads: number; sales: number; revenue: number; gasto: number; cpl: number }) => {
        const ads = adsByDate[row.date] || [];
        const gasto = ads.reduce((s, a) => s + a.gasto, 0);
        const cpl = row.leads > 0 ? gasto / row.leads : 0;
        return { ...row, gasto, cpl, ads };
    });
}

// --- Traffic type summary ---
export async function getTrafficTypeSummaryFromMongo(
    configId: string,
    multiplyRevenue: boolean
): Promise<{ frio: { leads: number; sales: number; revenue: number }; caliente: { leads: number; sales: number; revenue: number }; otro: { leads: number; sales: number; revenue: number } } | null> {
    const db = await getMongoDb();
    const leadsCol = db.collection('leads');
    const mult = multiplyRevenue ? 2 : 1;

    const cursor = leadsCol.aggregate([
        { $match: { config_id: configId, anuncio_normalized: { $ne: '' } } },
        {
            $addFields: {
                tipo: {
                    $switch: {
                        branches: [
                            { case: { $regexMatch: { input: { $toUpper: { $ifNull: ['$campana', ''] } }, regex: 'PQ' } }, then: 'caliente' },
                            { case: { $regexMatch: { input: { $toUpper: { $ifNull: ['$campana', ''] } }, regex: 'PF' } }, then: 'frio' }
                        ],
                        default: 'otro'
                    }
                }
            }
        },
        {
            $lookup: {
                from: 'sales',
                let: { cid: '$cliente_id' },
                pipeline: [
                    {
                        $match: {
                            $expr: { $eq: ['$cliente_id', '$$cid'] },
                            config_id: configId,
                            $or: [{ fuente: { $exists: false } }, { fuente: '' }, { fuente: { $not: { $regex: /org/i } } }]
                        }
                    },
                    { $group: { _id: null, cnt: { $sum: 1 }, rev: { $sum: { $multiply: ['$monto', mult] } } } }
                ],
                as: 's'
            }
        },
        {
            $group: {
                _id: '$tipo',
                leads: { $sum: 1 },
                sales: { $sum: { $ifNull: [{ $arrayElemAt: ['$s.cnt', 0] }, 0] } },
                revenue: { $sum: { $ifNull: [{ $arrayElemAt: ['$s.rev', 0] }, 0] } }
            }
        }
    ] as object[], { allowDiskUse: true });

    const result = { frio: { leads: 0, sales: 0, revenue: 0 }, caliente: { leads: 0, sales: 0, revenue: 0 }, otro: { leads: 0, sales: 0, revenue: 0 } };
    for await (const doc of cursor) {
        const k = (doc._id || 'otro') as keyof typeof result;
        if (result[k]) {
            result[k] = { leads: doc.leads, sales: doc.sales, revenue: doc.revenue };
        }
    }
    return result;
}

// --- Spend by traffic type (desde spend_data) ---
export async function getSpendByTrafficTypeFromMongo(reportId: ObjectId): Promise<{ frio: number; caliente: number; otro: number }> {
    const db = await getMongoDb();
    const cursor = db.collection('spend_data').aggregate([
        { $match: { report_id: reportId, is_daily: { $ne: true } } },
        {
            $addFields: {
                tipo: {
                    $switch: {
                        branches: [
                            { case: { $regexMatch: { input: { $toUpper: { $ifNull: ['$campaign_name', ''] } }, regex: 'PQ' } }, then: 'caliente' },
                            { case: { $regexMatch: { input: { $toUpper: { $ifNull: ['$campaign_name', ''] } }, regex: 'PF' } }, then: 'frio' }
                        ],
                        default: 'otro'
                    }
                }
            }
        },
        { $group: { _id: '$tipo', spend: { $sum: '$amount_spent' } } }
    ]);
    const r = { frio: 0, caliente: 0, otro: 0 };
    for await (const doc of cursor) {
        const k = (doc._id || 'otro') as keyof typeof r;
        if (r[k] !== undefined) r[k] = doc.spend;
    }
    return r;
}

// --- Sales by country ---
export async function getSalesByCountryFromMongo(
    configId: string,
    multiplyRevenue: boolean
): Promise<{ country: string; tracked_sales: number; organic_sales: number }[] | null> {
    const db = await getMongoDb();
    const mult = multiplyRevenue ? 2 : 1;

    const cursor = db.collection('leads').aggregate([
        { $match: { config_id: configId } },
        {
            $lookup: {
                from: 'sales',
                let: { cid: '$cliente_id' },
                pipeline: [
                    { $match: { $expr: { $eq: ['$cliente_id', '$$cid'] }, config_id: configId } },
                    { $project: { monto: 1, fuente: 1 } }
                ],
                as: 'sales'
            }
        },
        { $unwind: '$sales' },
        {
            $group: {
                _id: { pais: { $ifNull: ['$pais', 'Sin país'] }, org: { $regexMatch: { input: { $ifNull: ['$sales.fuente', ''] }, regex: /org/i } } },
                rev: { $sum: { $multiply: ['$sales.monto', mult] } }
            }
        }
    ] as object[], { allowDiskUse: true });

    const byCountry: Record<string, { tracked: number; organic: number }> = {};
    for await (const doc of cursor) {
        const c = doc._id.pais || 'Sin país';
        if (!byCountry[c]) byCountry[c] = { tracked: 0, organic: 0 };
        if (doc._id.org) byCountry[c].organic += doc.rev;
        else byCountry[c].tracked += doc.rev;
    }
    return Object.entries(byCountry).map(([country, v]) => ({
        country,
        tracked_sales: v.tracked,
        organic_sales: v.organic
    }));
}

// --- Sales by registration date by country ---
export async function getSalesByRegistrationDateByCountryFromMongo(
    configId: string,
    reportId: ObjectId,
    multiplyRevenue: boolean
): Promise<Record<string, { country: string; leads: number; sales: number; revenue: number; gasto: number }[]> | null> {
    const db = await getMongoDb();
    const mult = multiplyRevenue ? 2 : 1;

    const countrySpendCol = db.collection('country_spend_data');
    const spendByDateCountry: Record<string, Record<string, number>> = {};
    const csCursor = countrySpendCol.aggregate([
        { $match: { report_id: reportId, is_daily: true } },
        {
            $group: {
                _id: { day: { $dateToString: { format: '%Y-%m-%d', date: '$day' } }, country: '$country' },
                gasto: { $sum: '$amount_spent' }
            }
        }
    ]);
    for await (const d of csCursor) {
        if (!spendByDateCountry[d._id.day]) spendByDateCountry[d._id.day] = {};
        spendByDateCountry[d._id.day][d._id.country] = d.gasto;
    }

    const cursor = db.collection('leads').aggregate([
        { $match: { config_id: configId, fecha_registro: { $exists: true, $ne: null } } },
        {
            $addFields: {
                fecha_str: { $dateToString: { format: '%Y-%m-%d', date: '$fecha_registro' } }
            }
        },
        {
            $lookup: {
                from: 'sales',
                let: { cid: '$cliente_id' },
                pipeline: [
                    { $match: { $expr: { $eq: ['$cliente_id', '$$cid'] }, config_id: configId } },
                    { $group: { _id: null, cnt: { $sum: 1 }, rev: { $sum: { $multiply: ['$monto', mult] } } } }
                ],
                as: 's'
            }
        },
        {
            $group: {
                _id: { fecha: '$fecha_str', pais: { $ifNull: ['$pais', 'Sin país'] } },
                leads: { $sum: 1 },
                sales: { $sum: { $ifNull: [{ $arrayElemAt: ['$s.cnt', 0] }, 0] } },
                revenue: { $sum: { $ifNull: [{ $arrayElemAt: ['$s.rev', 0] }, 0] } }
            }
        }
    ] as object[], { allowDiskUse: true });

    const byDate: Record<string, { country: string; leads: number; sales: number; revenue: number; gasto: number }[]> = {};
    for await (const doc of cursor) {
        const dateStr = doc._id.fecha;
        const country = doc._id.pais || 'Sin país';
        const gasto = spendByDateCountry[dateStr]?.[country] ?? 0;
        if (!byDate[dateStr]) byDate[dateStr] = [];
        byDate[dateStr].push({
            country,
            leads: doc.leads,
            sales: doc.sales,
            revenue: doc.revenue,
            gasto
        });
    }
    return Object.keys(byDate).length > 0 ? byDate : null;
}

// --- Captation by traffic type ---
export async function getCaptationByTrafficTypeFromMongo(
    configId: string,
    reportId: ObjectId,
    multiplyRevenue: boolean
): Promise<{ frio: { date: string; leads: number; sales: number; revenue: number; gasto: number; cpl: number }[]; caliente: { date: string; leads: number; sales: number; revenue: number; gasto: number; cpl: number }[]; otro: { date: string; leads: number; sales: number; revenue: number; gasto: number; cpl: number }[] } | null> {
    const db = await getMongoDb();
    const leadsCol = db.collection('leads');
    const spendCol = db.collection('spend_data');
    const mult = multiplyRevenue ? 2 : 1;

    const spendByDateType: Record<string, { frio: number; caliente: number; otro: number }> = {};
    const spendCursor = spendCol.aggregate([
        { $match: { report_id: reportId, is_daily: true } },
        {
            $addFields: {
                tipo: {
                    $switch: {
                        branches: [
                            { case: { $regexMatch: { input: { $toUpper: { $ifNull: ['$campaign_name', ''] } }, regex: 'PQ' } }, then: 'caliente' },
                            { case: { $regexMatch: { input: { $toUpper: { $ifNull: ['$campaign_name', ''] } }, regex: 'PF' } }, then: 'frio' }
                        ],
                        default: 'otro'
                    }
                }
            }
        },
        {
            $group: {
                _id: { day: { $dateToString: { format: '%Y-%m-%d', date: '$day' } }, tipo: '$tipo' },
                gasto: { $sum: '$amount_spent' }
            }
        }
    ]);
    for await (const d of spendCursor) {
        const day = d._id.day;
        if (!spendByDateType[day]) spendByDateType[day] = { frio: 0, caliente: 0, otro: 0 };
        spendByDateType[day][d._id.tipo as keyof typeof spendByDateType[string]] = d.gasto;
    }

    const cursor = leadsCol.aggregate([
        { $match: { config_id: configId, fecha_registro: { $exists: true, $ne: null } } },
        {
            $addFields: {
                fecha_str: { $dateToString: { format: '%Y-%m-%d', date: '$fecha_registro' } },
                tipo: {
                    $switch: {
                        branches: [
                            { case: { $regexMatch: { input: { $toUpper: { $ifNull: ['$campana', ''] } }, regex: 'PQ' } }, then: 'caliente' },
                            { case: { $regexMatch: { input: { $toUpper: { $ifNull: ['$campana', ''] } }, regex: 'PF' } }, then: 'frio' }
                        ],
                        default: 'otro'
                    }
                }
            }
        },
        {
            $lookup: {
                from: 'sales',
                let: { cid: '$cliente_id' },
                pipeline: [
                    { $match: { $expr: { $eq: ['$cliente_id', '$$cid'] }, config_id: configId } },
                    { $group: { _id: null, cnt: { $sum: 1 }, rev: { $sum: { $multiply: ['$monto', mult] } } } }
                ],
                as: 's'
            }
        },
        {
            $group: {
                _id: { fecha: '$fecha_str', tipo: '$tipo' },
                leads: { $sum: 1 },
                sales: { $sum: { $ifNull: [{ $arrayElemAt: ['$s.cnt', 0] }, 0] } },
                revenue: { $sum: { $ifNull: [{ $arrayElemAt: ['$s.rev', 0] }, 0] } }
            }
        }
    ] as object[], { allowDiskUse: true });

    const byType: Record<string, Record<string, { leads: number; sales: number; revenue: number }>> = { frio: {}, caliente: {}, otro: {} };
    for await (const doc of cursor) {
        const dateStr = doc._id.fecha;
        const tipo = (doc._id.tipo || 'otro') as keyof typeof byType;
        byType[tipo][dateStr] = {
            leads: doc.leads,
            sales: doc.sales,
            revenue: doc.revenue
        };
    }

    const build = (tipo: 'frio' | 'caliente' | 'otro') => {
        const dates = new Set([...Object.keys(byType[tipo]), ...Object.keys(spendByDateType)]);
        return Array.from(dates)
            .sort()
            .map((dateStr) => {
                const d = byType[tipo][dateStr] || { leads: 0, sales: 0, revenue: 0 };
                const gasto = spendByDateType[dateStr]?.[tipo] ?? 0;
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
    return { frio: build('frio'), caliente: build('caliente'), otro: build('otro') };
}

// --- Country spend (desde country_spend_data) ---
export async function getCountrySpendFromMongo(reportId: ObjectId): Promise<{ byCountry: Record<string, number>; spendByDateAndCountry?: Record<string, Record<string, number>> }> {
    const db = await getMongoDb();
    const col = db.collection('country_spend_data');

    const byCountry: Record<string, number> = {};
    const byDateCountry: Record<string, Record<string, number>> = {};

    const allCursor = col.aggregate([
        { $match: { report_id: reportId, is_daily: { $ne: true } } },
        { $group: { _id: '$country', gasto: { $sum: '$amount_spent' } } }
    ]);
    for await (const d of allCursor) {
        const c = String(d._id || 'Sin país').trim();
        byCountry[c] = d.gasto;
    }

    const dailyCursor = col.aggregate([
        { $match: { report_id: reportId, is_daily: true, day: { $exists: true } } },
        {
            $group: {
                _id: { day: { $dateToString: { format: '%Y-%m-%d', date: '$day' } }, country: '$country' },
                gasto: { $sum: '$amount_spent' }
            }
        }
    ]);
    for await (const d of dailyCursor) {
        const dayStr = d._id.day;
        const c = String(d._id.country || 'Sin país').trim();
        if (!byDateCountry[dayStr]) byDateCountry[dayStr] = {};
        byDateCountry[dayStr][c] = d.gasto;
    }

    return {
        byCountry,
        spendByDateAndCountry: Object.keys(byDateCountry).length > 0 ? byDateCountry : undefined
    };
}

// --- Quality data desde MongoDB ---
export async function getQualityDataFromMongo(
    configId: string,
    reportId: ObjectId,
    multiplyRevenue: boolean,
    segmentationsData: Record<string, SpendSegmentation>
): Promise<{ summary: any; segments: any[]; factor_analysis: any } | null> {
    const db = await getMongoDb();
    const leadsCol = db.collection('leads');
    const mult = multiplyRevenue ? 2 : 1;

    const cursor = leadsCol.aggregate([
        { $match: { config_id: configId, anuncio_normalized: { $ne: '' } } },
        {
            $lookup: {
                from: 'sales',
                let: { cid: '$cliente_id' },
                pipeline: [
                    {
                        $match: {
                            $expr: { $eq: ['$cliente_id', '$$cid'] },
                            config_id: configId,
                            $or: [{ fuente: { $exists: false } }, { fuente: '' }, { fuente: { $not: { $regex: /org/i } } }]
                        }
                    },
                    { $group: { _id: null, cnt: { $sum: 1 }, rev: { $sum: { $multiply: ['$monto', mult] } } } }
                ],
                as: 's'
            }
        },
        {
            $group: {
                _id: {
                    an: '$anuncio_normalized',
                    seg: '$segmentacion_normalized',
                    an_orig: '$anuncio',
                    seg_orig: '$segmentacion',
                    campana: '$campana',
                    ad_id: '$ad_id',
                    qlead: { $ifNull: ['$qlead', 'Sin Clasificar'] },
                    ingresos: { $ifNull: ['$ingresos', 'No Especificado'] },
                    estudios: { $ifNull: ['$estudios', 'No Especificado'] },
                    ocupacion: { $ifNull: ['$ocupacion', 'No Especificado'] },
                    proposito: { $ifNull: ['$proposito', 'No Especificado'] },
                    edad: { $ifNull: ['$edad_especifica', 'No Especificado'] }
                },
                total_leads: { $sum: 1 },
                total_sales: { $sum: { $ifNull: [{ $arrayElemAt: ['$s.cnt', 0] }, 0] } },
                total_revenue: { $sum: { $ifNull: [{ $arrayElemAt: ['$s.rev', 0] }, 0] } },
                puntaje_sum: { $sum: { $ifNull: ['$puntaje', 0] } }
            }
        }
    ] as object[], { allowDiskUse: true });

    const rows: any[] = [];
    for await (const doc of cursor) {
        const qlead = String(doc._id.qlead || 'Sin Clasificar').trim() || 'Sin Clasificar';
        const ingresos = String(doc._id.ingresos || 'No Especificado').trim() || 'No Especificado';
        const estudios = String(doc._id.estudios || 'No Especificado').trim() || 'No Especificado';
        const ocupacion = String(doc._id.ocupacion || 'No Especificado').trim() || 'No Especificado';
        const edad = String(doc._id.edad || 'No Especificado').trim() || 'No Especificado';
        rows.push({
            ANUNCIO_NORMALIZED: doc._id.an,
            SEGMENTACION_NORMALIZED: doc._id.seg,
            ANUNCIO: doc._id.an_orig,
            SEGMENTACION: doc._id.seg_orig,
            CAMPAÑA: doc._id.campana,
            AD_ID: doc._id.ad_id,
            QLEAD: qlead,
            INGRESOS: ingresos,
            ESTUDIOS: estudios,
            OCUPACION: ocupacion,
            PROPOSITO: doc._id.proposito,
            EDAD_ESPECIFICA: edad,
            total_leads: doc.total_leads,
            total_sales: doc.total_sales,
            total_revenue: doc.total_revenue,
            PUNTAJE: doc.total_leads > 0 ? doc.puntaje_sum / doc.total_leads : 0
        });
    }

    if (rows.length === 0) return null;

    const { buildQualityAnalysis, analyzeFactors } = await import('@/lib/utils/qualityAnalysis');
    const qualityData = buildQualityAnalysis(rows, segmentationsData, multiplyRevenue);
    if (!qualityData) return null;
    qualityData.factor_analysis = analyzeFactors(qualityData.segments, 1.5);
    return qualityData;
}
