package ir.neonbrawl.myket;

import android.content.Intent;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.ArrayList;
import java.util.List;

import ir.myket.billingclient.IabHelper;
import ir.myket.billingclient.util.Inventory;
import ir.myket.billingclient.util.Purchase;
import ir.myket.billingclient.util.SkuDetails;

@CapacitorPlugin(name = "MyketBilling", requestCodes = { MyketBillingPlugin.RC_PURCHASE })
public class MyketBillingPlugin extends Plugin {
    static final int RC_PURCHASE = 10421;
    private IabHelper helper;
    private boolean ready = false;

    @PluginMethod
    public void connect(PluginCall call) {
        if (ready) { call.resolve(); return; }
        helper = new IabHelper(getContext(), call.getString("rsaKey"));
        helper.startSetup(result -> {
            if (result.isSuccess()) { ready = true; call.resolve(); }
            else call.reject(result.getMessage());
        });
    }

    @PluginMethod
    public void getPrices(PluginCall call) {
        if (!ready) { call.reject("not-connected"); return; }
        List<String> ids = new ArrayList<>();
        try { JSArray arr = call.getArray("productIds"); for (int i = 0; i < arr.length(); i++) ids.add(arr.getString(i)); }
        catch (Exception e) { call.reject("bad-ids"); return; }
        helper.queryInventoryAsync(true, ids, (result, inv) -> {
            if (result.isFailure()) { call.reject(result.getMessage()); return; }
            JSObject prices = new JSObject();
            for (String id : ids) { SkuDetails d = inv.getSkuDetails(id); if (d != null) prices.put(id, d.getPrice()); }
            JSObject r = new JSObject(); r.put("prices", prices); call.resolve(r);
        });
    }

    @PluginMethod
    public void purchase(PluginCall call) {
        if (!ready) { call.reject("not-connected"); return; }
        String sku = call.getString("productId");
        String payload = call.getString("payload", "");
        bridge.saveCall(call);
        final String callbackId = call.getCallbackId();
        getActivity().runOnUiThread(() -> helper.launchPurchaseFlow(getActivity(), sku, RC_PURCHASE, (result, purchase) -> {
            PluginCall saved = bridge.getSavedCall(callbackId);
            if (saved == null) return;
            if (result.isFailure() || purchase == null) saved.reject(result.getMessage());
            else saved.resolve(toJs(purchase));
            bridge.releaseCall(saved);
        }, payload));
    }

    @PluginMethod
    public void consume(PluginCall call) {
        if (!ready) { call.reject("not-connected"); return; }
        String sku = call.getString("productId");
        helper.queryInventoryAsync((result, inv) -> {
            if (result.isFailure()) { call.reject(result.getMessage()); return; }
            Purchase p = inv.getPurchase(sku);
            if (p == null) { call.resolve(); return; }
            helper.consumeAsync(p, (purchase, r) -> { if (r.isSuccess()) call.resolve(); else call.reject(r.getMessage()); });
        });
    }

    @PluginMethod
    public void pending(PluginCall call) {
        if (!ready) { call.reject("not-connected"); return; }
        helper.queryInventoryAsync((result, inv) -> {
            if (result.isFailure()) { call.reject(result.getMessage()); return; }
            JSArray arr = new JSArray();
            for (Purchase p : inv.getAllPurchases()) arr.put(toJs(p));
            JSObject r = new JSObject(); r.put("purchases", arr); call.resolve(r);
        });
    }

    private JSObject toJs(Purchase p) {
        JSObject o = new JSObject();
        o.put("productId", p.getSku());
        o.put("purchaseToken", p.getToken());
        o.put("orderId", p.getOrderId());
        o.put("developerPayload", p.getDeveloperPayload());
        return o;
    }

    @Override
    protected void handleOnActivityResult(int requestCode, int resultCode, Intent data) {
        super.handleOnActivityResult(requestCode, resultCode, data);
        if (helper != null) helper.handleActivityResult(requestCode, resultCode, data);
    }

    @Override
    protected void handleOnDestroy() {
        if (helper != null) { try { helper.dispose(); } catch (Exception ignored) { } }
        helper = null; ready = false;
    }
}
