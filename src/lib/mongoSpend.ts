'use server';

import { ObjectId } from 'mongodb';
import { getMongoDb } from '@/lib/mongodb';
import { processSpendCSV, processCountryCSV, normalizeAdName } from '@/lib/utils/csvProcessor';

export interface StoredSpendReport {
    reportId: ObjectId;
    configId: string;
    exchangeRate: number;
    multiplyRevenue: boolean;
}

export async function storeSpendFromCSV(
    csvContent: string,
    configId: string,
    exchangeRate: number,
    multiplyRevenue: boolean
): Promise<ObjectId> {
    const spendResult = await processSpendCSV(csvContent, exchangeRate);
    const db = await getMongoDb();
    const col = db.collection('spend_data');

    const reportId = new ObjectId();
    const docs: Record<string, unknown>[] = [];

    for (const seg of Object.values(spendResult.segmentations)) {
        docs.push({
            report_id: reportId,
            config_id: configId,
            ad_name_normalized: seg.ad_name_normalized,
            segmentation_normalized: normalizeAdName(seg.segmentation_name),
            segmentation_name: seg.segmentation_name,
            campaign_name: seg.campaign_name,
            ad_name_original: seg.ad_name_original,
            ad_id: seg.ad_id || '',
            amount_spent: seg.spend,
            exchange_rate: exchangeRate,
            multiply_revenue: multiplyRevenue
        });
    }

    if (spendResult.spendByDate) {
        for (const [dateKey, amount] of Object.entries(spendResult.spendByDate)) {
            const parts = dateKey.split('|');
            if (parts.length >= 2) {
                const dayStr = parts[0];
                const adKey = parts.slice(1).join('|');
                const seg = spendResult.segmentations[adKey];
                if (seg) {
                    docs.push({
                        report_id: reportId,
                        config_id: configId,
                        ad_name_normalized: seg.ad_name_normalized,
                        segmentation_normalized: normalizeAdName(seg.segmentation_name),
                        day: new Date(dayStr),
                        amount_spent: amount,
                        is_daily: true
                    });
                }
            }
        }
    }

    if (docs.length > 0) {
        await col.insertMany(docs);
    }

    return reportId;
}

export async function storeCountrySpendFromCSV(
    csvContent: string,
    reportId: ObjectId,
    configId: string,
    exchangeRate: number
): Promise<void> {
    const { byCountry, spendByDateAndCountry } = await processCountryCSV(csvContent, exchangeRate);
    const db = await getMongoDb();
    const col = db.collection('country_spend_data');

    const docs: Record<string, unknown>[] = [];
    for (const [country, amount] of Object.entries(byCountry)) {
        docs.push({
            report_id: reportId,
            config_id: configId,
            country: country.trim(),
            amount_spent: amount,
            is_daily: false
        });
    }
    if (spendByDateAndCountry) {
        for (const [dayStr, countries] of Object.entries(spendByDateAndCountry)) {
            for (const [country, amount] of Object.entries(countries)) {
                docs.push({
                    report_id: reportId,
                    config_id: configId,
                    country: country.trim(),
                    day: new Date(dayStr),
                    amount_spent: amount,
                    is_daily: true
                });
            }
        }
    }
    if (docs.length > 0) {
        await col.insertMany(docs);
    }
}

export async function getSpendAggregationByAd(
    reportId: ObjectId
): Promise<Record<string, { spend: number; campaign_name: string; ad_id: string }>> {
    const db = await getMongoDb();
    const col = db.collection('spend_data');

    const cursor = col.aggregate([
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

    const result: Record<string, { spend: number; campaign_name: string; ad_id: string }> = {};
    for await (const doc of cursor) {
        const key = `${doc._id.ad}|${doc._id.seg}`;
        result[key] = {
            spend: doc.spend,
            campaign_name: doc.campaign_name || '',
            ad_id: doc.ad_id || ''
        };
    }
    return result;
}

export async function getSpendByDate(reportId: ObjectId): Promise<Record<string, number>> {
    const db = await getMongoDb();
    const col = db.collection('spend_data');

    const cursor = col.aggregate([
        { $match: { report_id: reportId, is_daily: true } },
        {
            $group: {
                _id: { day: { $dateToString: { format: '%Y-%m-%d', date: '$day' } }, ad: '$ad_name_normalized', seg: '$segmentation_normalized' },
                amount: { $sum: '$amount_spent' }
            }
        }
    ]);

    const result: Record<string, number> = {};
    for await (const doc of cursor) {
        const dayStr = doc._id.day;
        const key = `${dayStr}|${doc._id.ad}|${doc._id.seg}`;
        result[key] = doc.amount;
    }
    return result;
}
