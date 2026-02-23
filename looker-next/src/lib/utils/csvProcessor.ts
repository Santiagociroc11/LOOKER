import Papa from 'papaparse';

export function cleanDisplayName(name: string | null | undefined): string {
    if (!name) return '';
    let str = String(name);

    str = str.replace(/^\{\{adsutm_content=/, '');
    str = str.replace(/^\{\{adset\.name\}\}$/, '');
    str = str.replace(/^\{\{([^}]*)\}\}/, '');
    str = str.replace(/\.(mp4|mov|avi|mkv|wmv)$/i, '');
    str = str.replace(/\.(jpg|jpeg|png|gif|webp)$/i, '');

    str = str.replace(/\{\{|\}\}|=/g, '');

    const trimmed = str.trim();
    if (trimmed === '-' || trimmed === '' || trimmed === 'undefined') {
        return '[Sin nombre]';
    }
    return trimmed;
}

export function normalizeAdName(name: string | null | undefined): string {
    const cleaned = cleanDisplayName(name);
    if (!cleaned || cleaned === '[Sin nombre]') return '';

    let normalized = cleaned.toLowerCase();

    // Remove accents
    normalized = normalized.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

    // Remove special characters, keep only letters, numbers, spaces, dashes, and underscores
    normalized = normalized.replace(/[^a-z0-9\s\-_]/g, '');

    // Normalize multiple spaces
    normalized = normalized.replace(/\s+/g, ' ');

    return normalized.trim();
}

export interface CSVDataRow {
    'campaign name'?: string;
    'ad set name'?: string;
    'ad name'?: string;
    'amount spent'?: string;
    'placement'?: string;
    'platform'?: string;
    'ad id'?: string;
}

export interface SpendSegmentation {
    campaign_name: string;
    ad_set_name: string;
    ad_name_original: string;
    ad_name_normalized: string;
    ad_id: string;
    segmentation_name: string;
    spend: number;
}

export async function processSpendCSV(csvContent: string, exchangeRate: number = 0) {
    return new Promise<{ segmentations: Record<string, SpendSegmentation>, mapping: Record<string, string> }>((resolve, reject) => {
        Papa.parse<CSVDataRow>(csvContent, {
            header: true,
            skipEmptyLines: true,
            transformHeader: (header) => header.trim().toLowerCase(),
            complete: (results) => {
                const segmentations: Record<string, SpendSegmentation> = {};
                const spend_mapping: Record<string, string> = {};

                for (const data of results.data) {
                    const campaign_name = data['campaign name']?.trim() || '';
                    const ad_set_name = data['ad set name']?.trim() || '';
                    const ad_name_original = data['ad name']?.trim() || '';
                    const ad_id = data['ad id']?.trim() || '';

                    let amountStr = data['amount spent'] || '0';
                    amountStr = amountStr.replace(',', '.');
                    let amount = parseFloat(amountStr) || 0;

                    if (exchangeRate > 0) {
                        amount = amount / exchangeRate;
                    }

                    if (campaign_name && ad_set_name && ad_name_original) {
                        const ad_name_normalized = normalizeAdName(ad_name_original);
                        const segmentation_name = ad_set_name;
                        const unique_key = `${ad_name_normalized}|${normalizeAdName(segmentation_name)}`;

                        if (!segmentations[unique_key]) {
                            segmentations[unique_key] = {
                                campaign_name,
                                ad_set_name,
                                ad_name_original,
                                ad_name_normalized,
                                ad_id,
                                segmentation_name,
                                spend: 0
                            };

                            if (!spend_mapping[ad_name_normalized]) {
                                spend_mapping[ad_name_normalized] = ad_name_original;
                            }
                        }

                        segmentations[unique_key].spend += amount;
                    }
                }

                resolve({ segmentations, mapping: spend_mapping });
            },
            error: (error: Error) => {
                reject(error);
            }
        });
    });
}

/** CSV formato: Day,Amount Spent,Campaign Name,Leads,...,Country */
export async function processCountryCSV(csvContent: string, exchangeRate: number = 0): Promise<Record<string, number>> {
    return new Promise((resolve, reject) => {
        Papa.parse<Record<string, string>>(csvContent, {
            header: true,
            skipEmptyLines: true,
            transformHeader: (h) => h.trim().toLowerCase(),
            complete: (results) => {
                const byCountry: Record<string, number> = {};
                for (const row of results.data) {
                    const country = (row['country'] || row['país'] || '').trim();
                    if (!country) continue;

                    let amountStr = row['amount spent'] || '0';
                    amountStr = amountStr.replace(',', '.');
                    let amount = parseFloat(amountStr) || 0;

                    if (exchangeRate > 0) {
                        amount = amount / exchangeRate;
                    }

                    byCountry[country] = (byCountry[country] || 0) + amount;
                }
                resolve(byCountry);
            },
            error: (e: Error) => reject(e)
        });
    });
}
