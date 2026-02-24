'use server';

import { ObjectId } from 'mongodb';
import { getMongoDb } from '@/lib/mongodb';
import { cleanDisplayName, normalizeAdName } from '@/lib/utils/csvProcessor';

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

    const cursor = leadsCol.aggregate(pipeline as object[]);
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
            revenue: doc.total_revenue * revenueMult
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
