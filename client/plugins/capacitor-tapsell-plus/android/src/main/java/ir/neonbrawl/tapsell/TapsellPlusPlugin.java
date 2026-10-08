package ir.neonbrawl.tapsell;

import android.view.Gravity;
import android.view.ViewGroup;
import android.widget.FrameLayout;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import ir.tapsell.plus.AdRequestCallback;
import ir.tapsell.plus.AdShowListener;
import ir.tapsell.plus.TapsellPlus;
import ir.tapsell.plus.TapsellPlusBannerType;
import ir.tapsell.plus.TapsellPlusInitListener;
import ir.tapsell.plus.model.AdNetworkError;
import ir.tapsell.plus.model.AdNetworks;
import ir.tapsell.plus.model.TapsellPlusAdModel;
import ir.tapsell.plus.model.TapsellPlusErrorModel;

@CapacitorPlugin(name = "TapsellPlus")
public class TapsellPlusPlugin extends Plugin {

    private FrameLayout bannerContainer;
    private String bannerResponseId;

    @PluginMethod
    public void initialize(PluginCall call) {
        String key = call.getString("key");
        getActivity().runOnUiThread(() -> TapsellPlus.initialize(getActivity(), key, new TapsellPlusInitListener() {
            @Override public void onInitializeSuccess(AdNetworks adNetworks) {
                TapsellPlus.setGDPRConsent(getContext(), true);
                call.resolve();
            }
            @Override public void onInitializeFailed(AdNetworks adNetworks, AdNetworkError error) {
                call.reject(error.getErrorMessage());
            }
        }));
    }

    @PluginMethod
    public void requestRewarded(PluginCall call) {
        String zone = call.getString("zoneId");
        getActivity().runOnUiThread(() -> TapsellPlus.requestRewardedVideoAd(getActivity(), zone, new AdRequestCallback() {
            @Override public void response(TapsellPlusAdModel model) {
                JSObject r = new JSObject(); r.put("responseId", model.getResponseId()); call.resolve(r);
            }
            @Override public void error(String message) { call.reject(message); }
        }));
    }

    @PluginMethod
    public void showRewarded(PluginCall call) {
        String id = call.getString("responseId");
        final boolean[] rewarded = { false };
        getActivity().runOnUiThread(() -> TapsellPlus.showRewardedVideoAd(getActivity(), id, new AdShowListener() {
            @Override public void onOpened(TapsellPlusAdModel m) { }
            @Override public void onRewarded(TapsellPlusAdModel m) { rewarded[0] = true; }
            @Override public void onClosed(TapsellPlusAdModel m) {
                JSObject r = new JSObject(); r.put("rewarded", rewarded[0]); call.resolve(r);
            }
            @Override public void onError(TapsellPlusErrorModel e) { call.reject(e.getErrorMessage()); }
        }));
    }

    @PluginMethod
    public void requestInterstitial(PluginCall call) {
        String zone = call.getString("zoneId");
        getActivity().runOnUiThread(() -> TapsellPlus.requestInterstitialAd(getActivity(), zone, new AdRequestCallback() {
            @Override public void response(TapsellPlusAdModel model) {
                JSObject r = new JSObject(); r.put("responseId", model.getResponseId()); call.resolve(r);
            }
            @Override public void error(String message) { call.reject(message); }
        }));
    }

    @PluginMethod
    public void showInterstitial(PluginCall call) {
        String id = call.getString("responseId");
        getActivity().runOnUiThread(() -> TapsellPlus.showInterstitialAd(getActivity(), id, new AdShowListener() {
            @Override public void onOpened(TapsellPlusAdModel m) { }
            @Override public void onClosed(TapsellPlusAdModel m) { call.resolve(); }
            @Override public void onError(TapsellPlusErrorModel e) { call.reject(e.getErrorMessage()); }
        }));
    }

    @PluginMethod
    public void showBanner(PluginCall call) {
        String zone = call.getString("zoneId");
        getActivity().runOnUiThread(() -> {
            if (bannerContainer == null) {
                bannerContainer = new FrameLayout(getContext());
                FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
                lp.gravity = Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL;
                ((ViewGroup) getActivity().findViewById(android.R.id.content)).addView(bannerContainer, lp);
            }
            TapsellPlus.requestStandardBannerAd(getActivity(), zone, TapsellPlusBannerType.BANNER_320x50, new AdRequestCallback() {
                @Override public void response(TapsellPlusAdModel model) {
                    bannerResponseId = model.getResponseId();
                    TapsellPlus.showStandardBannerAd(getActivity(), bannerResponseId, bannerContainer, new AdShowListener() {
                        @Override public void onOpened(TapsellPlusAdModel m) { }
                        @Override public void onError(TapsellPlusErrorModel e) { }
                    });
                    call.resolve();
                }
                @Override public void error(String message) { call.reject(message); }
            });
        });
    }

    @PluginMethod
    public void hideBanner(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (bannerContainer != null && bannerResponseId != null) {
                TapsellPlus.destroyStandardBanner(getActivity(), bannerResponseId, bannerContainer);
                bannerResponseId = null;
            }
            call.resolve();
        });
    }
}
