import mixpanel from 'mixpanel-browser'

/**
 * Usage analytics. The Mixpanel project token comes from NEXT_PUBLIC_MIXPANEL_TOKEN (see .env);
 * leaving it empty turns analytics off. Users can opt out in Settings. Events never include
 * prompt text, model output, error messages or API keys.
 */

const token = process.env.NEXT_PUBLIC_MIXPANEL_TOKEN
let initialized = false
let enabled = false

export function setupAnalytics(allowed: boolean) {
    enabled = allowed
    if (!token || typeof window == 'undefined') return

    if (!initialized) {
        mixpanel.init(token, {
            debug: false,
            track_pageview: allowed,
            persistence: 'localStorage',
            opt_out_tracking_by_default: !allowed,
        })
        initialized = true
        return
    }

    if (allowed && mixpanel.has_opted_out_tracking()) mixpanel.opt_in_tracking()
    if (!allowed && !mixpanel.has_opted_out_tracking()) mixpanel.opt_out_tracking()
}

export function track(event: string, properties?: Record<string, string | number | boolean | undefined>) {
    if (!initialized || !enabled) return
    try {
        mixpanel.track(event, properties)
    } catch {
        // analytics must never break the app
    }
}
