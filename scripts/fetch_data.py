import os
import json
import datetime
import pandas as pd
import numpy as np
import yfinance as yf

# Define tickers mapping
TICKER_MAP = {
    "^JKSE": "IHSG",
    "BBCA.JK": "BBCA",
    "BBRI.JK": "BBRI",
    "BMRI.JK": "BMRI",
    "TLKM.JK": "TLKM",
    "BREN.JK": "BREN",
    "AMMN.JK": "AMMN"
}

def main():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    project_dir = os.path.dirname(script_dir)
    data_dir = os.path.join(project_dir, "data")
    os.makedirs(data_dir, exist_ok=True)
    
    print("Fetching data from Yahoo Finance...")
    
    # We fetch from early 2016 to ensure we have historical data from 2016-06-01
    # and MA50 calculations are fully populated starting 2016-06-01.
    end_date = datetime.date.today()
    start_date = datetime.date(2016, 1, 1)
    
    prices_data = {}
    raw_dfs = {}
    
    for yf_ticker, clean_ticker in TICKER_MAP.items():
        print(f"Downloading {clean_ticker} ({yf_ticker})...")
        try:
            df = yf.download(yf_ticker, start=start_date, end=end_date, progress=False)
            if df.empty:
                print(f"Warning: Could not fetch data for {clean_ticker}")
                continue
            
            # Flatten multi-index if present
            if isinstance(df.columns, pd.MultiIndex):
                df.columns = df.columns.get_level_values(0)
                
            # Clean dataframe columns and index
            df = df.reset_index()
            df.columns = [col.lower() if isinstance(col, str) else col for col in df.columns]
            
            # Rename Date to date if needed
            if 'date' not in df.columns and 'Date' in df.columns:
                df.rename(columns={'Date': 'date'}, inplace=True)
                
            # Ensure standard column naming
            df = df[['date', 'open', 'high', 'low', 'close', 'volume']].copy()
            
            # Convert series to standard types
            df['date'] = pd.to_datetime(df['date']).dt.strftime('%Y-%m-%d')
            df['close'] = pd.to_numeric(df['close'], errors='coerce')
            df['high'] = pd.to_numeric(df['high'], errors='coerce')
            df['low'] = pd.to_numeric(df['low'], errors='coerce')
            df['open'] = pd.to_numeric(df['open'], errors='coerce')
            df['volume'] = pd.to_numeric(df['volume'], errors='coerce')
            
            # Drop rows with NaN in critical columns
            df.dropna(subset=['close', 'high', 'low'], inplace=True)
            df.sort_values('date', inplace=True)
            df.reset_index(drop=True, inplace=True)
            
            raw_dfs[clean_ticker] = df
        except Exception as e:
            print(f"Error downloading {clean_ticker}: {e}")

    # We need to make sure we align the dates.
    # The benchmark IHSG determines the trading days.
    if 'IHSG' not in raw_dfs:
        raise Exception("Failed to fetch IHSG data. Cannot proceed.")
        
    ihsg_df = raw_dfs['IHSG']
    # Select all trading days starting from 2016-06-01
    ihsg_df_from_2016 = ihsg_df[ihsg_df['date'] >= '2016-06-01']
    active_dates = ihsg_df_from_2016['date'].tolist()
    
    # We will compute indicators for each stock using its full history first,
    # so we don't have NaN values at the beginning of the 252-day window.
    processed_dfs = {}
    for ticker, df in raw_dfs.items():
        # Calculate MA20 and MA50
        df['ma20'] = df['close'].rolling(window=20).mean()
        df['ma50'] = df['close'].rolling(window=50).mean()
        
        # Calculate volume color based on daily price changes
        df['prev_close'] = df['close'].shift(1)
        df['warna_volume'] = np.where(df['close'] > df['prev_close'], '#12C286',
                              np.where(df['close'] < df['prev_close'], '#FF5555', '#9CA3AF'))
        df.loc[df['prev_close'].isna(), 'warna_volume'] = '#9CA3AF'
        
        # Replace NaNs or infinities if any using ffill and bfill
        df.replace([np.inf, -np.inf], np.nan, inplace=True)
        df = df.ffill().bfill()
        
        # In case there are still NaNs (e.g. not enough data at start)
        df.fillna(0, inplace=True)
        
        processed_dfs[ticker] = df

    # Now we align all dataframes to the 252 active dates
    aligned_dfs = {}
    for ticker, df in processed_dfs.items():
        # Find actual first trading date (where close > 0)
        non_zero = df[df['close'] > 0]
        if not non_zero.empty:
            first_active_date = non_zero['date'].iloc[0]
        else:
            first_active_date = df['date'].iloc[0]
            
        date_df = pd.DataFrame({'date': active_dates})
        merged = pd.merge(date_df, df, on='date', how='left')
        
        # Add active column based on the first actual trading date
        merged['active'] = merged['date'] >= first_active_date
        
        # Fill missing values if any (e.g. minor holiday misalignments)
        merged = merged.ffill().bfill()
        
        # Fill numeric fields with 0 and warna_volume/active with appropriate defaults
        fill_values = {col: 0 for col in merged.columns if col not in ['warna_volume', 'date', 'active']}
        fill_values['warna_volume'] = '#9CA3AF'
        merged.fillna(value=fill_values, inplace=True)
        merged['active'] = merged['active'].fillna(True).astype(bool)
        
        # Now compute relative performance (rebased to 100 on the first day of this 252-day window)
        first_close = merged['close'].iloc[0]
        if first_close == 0:
            first_close = 1.0 # prevent division by zero
        merged['rebased'] = 100 * (merged['close'] / first_close)
        
        aligned_dfs[ticker] = merged

    # Print record count verification
    for ticker, df in aligned_dfs.items():
        print(f"{ticker} has {len(df)} aligned rows")
        
    # Generate prices.json structure
    prices_json = {}
    for ticker, df in aligned_dfs.items():
        prices_json[ticker] = []
        for _, row in df.iterrows():
            prices_json[ticker].append({
                "date": row['date'],
                "open": float(row['open']),
                "high": float(row['high']),
                "low": float(row['low']),
                "close": float(row['close']),
                "volume": int(row['volume']),
                "ma20": float(row['ma20']),
                "ma50": float(row['ma50']),
                "warna_volume": str(row['warna_volume']),
                "rebased": float(row['rebased']),
                "active": bool(row['active'])
            })
            
    # Save prices.json
    prices_path = os.path.join(data_dir, "prices.json")
    with open(prices_path, 'w') as f:
        json.dump(prices_json, f, indent=2)
    print(f"Saved prices to {prices_path}")
    
    # Calculate returns for each stock and IHSG
    returns = {}
    for ticker, df in aligned_dfs.items():
        c_first = df['close'].iloc[0]
        c_latest = df['close'].iloc[-1]
        if c_first != 0:
            returns[ticker] = float((c_latest - c_first) / c_first * 100)
        else:
            returns[ticker] = 0.0
        
    # Determine top outperformer and top underperformer
    # Exclude IHSG
    stock_returns = {t: r for t, r in returns.items() if t != 'IHSG'}
    top_outperformer_ticker = max(stock_returns, key=stock_returns.get)
    top_underperformer_ticker = min(stock_returns, key=stock_returns.get)
    
    # Market Status (Bullish / Bearish)
    ihsg_df_aligned = aligned_dfs['IHSG']
    latest_ihsg_close = ihsg_df_aligned['close'].iloc[-1]
    latest_ihsg_ma50 = ihsg_df_aligned['ma50'].iloc[-1]
    status_pasar = "Bullish" if latest_ihsg_close > latest_ihsg_ma50 else "Bearish"
    
    # Generate meta.json structure
    meta_json = {
        "last_update": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "status_pasar": status_pasar,
        "ihsg_current": float(latest_ihsg_close),
        "returns": returns,
        "top_outperformer": {
            "ticker": top_outperformer_ticker,
            "return": stock_returns[top_outperformer_ticker]
        },
        "top_underperformer": {
            "ticker": top_underperformer_ticker,
            "return": stock_returns[top_underperformer_ticker]
        }
    }
    
    # Save meta.json
    meta_path = os.path.join(data_dir, "meta.json")
    with open(meta_path, 'w') as f:
        json.dump(meta_json, f, indent=2)
    print(f"Saved meta data to {meta_path}")

if __name__ == "__main__":
    main()
