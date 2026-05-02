const { createClient } = require('@supabase/supabase-js');

let _client = null;
function db() {
  if (!_client) {
    _client = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY
    );
  }
  return _client;
}

function normalizePhone(phone) {
  const s = String(phone || '').trim().replace(/\s+/g, '');
  return s.startsWith('+') ? s : '+' + s;
}

class StrendusAPIService {
  normalizePhone(phone) { return normalizePhone(phone); }

  async verifyUser(phone) {
    const p = normalizePhone(phone);
    const { data: user } = await db()
      .from('users')
      .select('client_id, name, balance, email')
      .eq('phone', p)
      .maybeSingle();

    if (!user) return { exists: false, message: 'Usuario no encontrado' };

    return {
      exists: true,
      user: { clientId: user.client_id, name: user.name, balance: user.balance, email: user.email }
    };
  }

  async verifyByClientId(clientId, phone) {
    const input = clientId.trim();
    let user = null;

    const { data: byId } = await db().from('users').select('*').eq('client_id', input).maybeSingle();
    if (byId) {
      user = byId;
    } else {
      const { data: byEmail } = await db().from('users').select('*').ilike('email', input).maybeSingle();
      user = byEmail;
    }

    if (!user) return { success: false, message: 'Número de cliente o correo no encontrado' };

    if (normalizePhone(user.phone) !== normalizePhone(phone)) {
      return {
        success: false,
        message: `El número de cliente ${clientId} está registrado con otro número de teléfono.`,
        registeredPhone: user.phone.slice(-4)
      };
    }

    return {
      success: true,
      user: { clientId: user.client_id, name: user.name, balance: user.balance, email: user.email }
    };
  }

  async getBalance(phone) {
    const { data } = await db().from('users').select('balance').eq('phone', normalizePhone(phone)).maybeSingle();
    return data?.balance ?? 0;
  }

  async setBalance(phone, balance) {
    const { data } = await db()
      .from('users')
      .update({ balance })
      .eq('phone', normalizePhone(phone))
      .select('balance')
      .single();
    return data?.balance ?? null;
  }

  async updateBalance(phone, delta) {
    const current = await this.getBalance(phone);
    return this.setBalance(phone, current + delta);
  }

  async getUserInfo(phone) {
    const p = normalizePhone(phone);
    const { data: user } = await db()
      .from('users')
      .select('client_id, name, email, balance')
      .eq('phone', p)
      .maybeSingle();

    if (!user) return null;

    const { data: bets } = await db().from('bets').select('status').eq('user_phone', p);
    const list = bets || [];

    return {
      clientId: user.client_id,
      name: user.name,
      email: user.email,
      balance: user.balance,
      totalBets: list.length,
      pendingBets: list.filter(b => b.status === 'pending').length,
      wonBets: list.filter(b => b.status === 'won').length,
      lostBets: list.filter(b => b.status === 'lost').length
    };
  }

  async createBet(phone, betData) {
    const p = normalizePhone(phone);
    const { data: user } = await db().from('users').select('balance').eq('phone', p).maybeSingle();

    if (!user) return { success: false, message: 'Usuario no encontrado' };
    if (user.balance < betData.amount) {
      return { success: false, message: 'Saldo insuficiente', currentBalance: user.balance };
    }

    const betId = `BET-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const newBalance = user.balance - betData.amount;

    const { error } = await db().from('bets').insert({
      id: betId,
      user_phone: p,
      game_id: betData.gameId,
      game: betData.game,
      team: betData.team,
      odds: betData.odds,
      amount: betData.amount,
      potential_win: betData.potentialWin,
      status: 'pending',
      created_at: new Date().toISOString(),
      result: null
    });

    if (error) return { success: false, message: error.message };

    await db().from('users').update({ balance: newBalance }).eq('phone', p);

    return {
      success: true,
      bet: { id: betId, ...betData, status: 'pending', createdAt: new Date().toISOString() },
      newBalance
    };
  }

  async getBetHistory(phone, limit = 15) {
    const { data } = await db()
      .from('bets')
      .select('*')
      .eq('user_phone', normalizePhone(phone))
      .order('created_at', { ascending: false })
      .limit(limit);
    return (data || []).map(this._mapBet);
  }

  async getBet(phone, betId) {
    const { data } = await db()
      .from('bets')
      .select('*')
      .eq('id', betId)
      .eq('user_phone', normalizePhone(phone))
      .maybeSingle();
    return data ? this._mapBet(data) : null;
  }

  async getPendingBets(phone) {
    const { data } = await db()
      .from('bets')
      .select('*')
      .eq('user_phone', normalizePhone(phone))
      .eq('status', 'pending')
      .order('created_at', { ascending: false });
    return (data || []).map(this._mapBet);
  }

  async getAllPendingBets() {
    const { data } = await db()
      .from('bets')
      .select('*, users(name)')
      .eq('status', 'pending');
    return (data || []).map(b => ({
      ...this._mapBet(b),
      userPhone: b.user_phone,
      userName: b.users?.name
    }));
  }

  async cancelBet(phone, betId) {
    const bet = await this.getBet(phone, betId);
    if (!bet) return { success: false, message: 'Apuesta no encontrada' };
    if (bet.status !== 'pending') return { success: false, message: 'Solo se pueden cancelar apuestas pendientes' };

    await db().from('bets').update({
      status: 'cancelled',
      cancelled_at: new Date().toISOString()
    }).eq('id', betId);

    const newBalance = await this.updateBalance(phone, bet.amount);
    return { success: true, refundedAmount: bet.amount, newBalance };
  }

  async updateBetResult(phone, betId, won, result) {
    const bet = await this.getBet(phone, betId);
    if (!bet) return false;

    await db().from('bets').update({
      status: won ? 'won' : 'lost',
      result,
      settled_at: new Date().toISOString()
    }).eq('id', betId);

    if (won) await this.updateBalance(phone, bet.potentialWin);

    const newBalance = await this.getBalance(phone);
    return { success: true, won, amount: won ? bet.potentialWin : bet.amount, newBalance };
  }

  // --- Parlay methods ---

  async createParlay(phone, parlayData) {
    const p = normalizePhone(phone);
    const { data: user } = await db().from('users').select('balance').eq('phone', p).maybeSingle();

    if (!user) return { success: false, message: 'Usuario no encontrado' };
    if (user.balance < parlayData.amount) {
      return { success: false, message: 'Saldo insuficiente', currentBalance: user.balance };
    }

    const parlayId = `PAR-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const newBalance = user.balance - parlayData.amount;

    const { error } = await db().from('parlays').insert({
      id: parlayId,
      user_phone: p,
      legs: parlayData.legs,
      combined_odds: parlayData.combinedOdds,
      amount: parlayData.amount,
      potential_win: parlayData.potentialWin,
      status: 'pending',
      created_at: new Date().toISOString()
    });

    if (error) return { success: false, message: error.message };

    await db().from('users').update({ balance: newBalance }).eq('phone', p);

    return {
      success: true,
      parlay: { id: parlayId, ...parlayData, status: 'pending' },
      newBalance
    };
  }

  async getParlay(phone, parlayId) {
    const { data } = await db()
      .from('parlays')
      .select('*')
      .eq('id', parlayId)
      .eq('user_phone', normalizePhone(phone))
      .maybeSingle();
    return data ? this._mapParlay(data) : null;
  }

  async getParlayHistory(phone, limit = 10) {
    const { data } = await db()
      .from('parlays')
      .select('*')
      .eq('user_phone', normalizePhone(phone))
      .order('created_at', { ascending: false })
      .limit(limit);
    return (data || []).map(p => this._mapParlay(p));
  }

  async getAllPendingParlays() {
    const { data } = await db()
      .from('parlays')
      .select('*')
      .eq('status', 'pending');
    return (data || []).map(p => this._mapParlay(p));
  }

  async cancelParlay(phone, parlayId) {
    const parlay = await this.getParlay(phone, parlayId);
    if (!parlay) return { success: false, message: 'Parlay no encontrado' };
    if (parlay.status !== 'pending') return { success: false, message: 'Solo se pueden cancelar parlays pendientes' };

    await db().from('parlays').update({
      status: 'cancelled',
      cancelled_at: new Date().toISOString()
    }).eq('id', parlayId);

    const newBalance = await this.updateBalance(phone, parlay.amount);
    return { success: true, refundedAmount: parlay.amount, newBalance };
  }

  async settleParlayLeg(parlayId, legGameId, won, result) {
    const { data: row } = await db().from('parlays').select('*').eq('id', parlayId).maybeSingle();
    if (!row) return null;

    const parlay = this._mapParlay(row);
    const legs = parlay.legs.map(l =>
      l.gameId === legGameId ? { ...l, status: won ? 'won' : 'lost', result } : l
    );

    const anyLost = legs.some(l => l.status === 'lost');
    const allWon = legs.every(l => l.status === 'won');
    const newStatus = anyLost ? 'lost' : allWon ? 'won' : 'pending';

    const update = { legs };
    if (newStatus !== 'pending') {
      update.status = newStatus;
      update.settled_at = new Date().toISOString();
    }

    await db().from('parlays').update(update).eq('id', parlayId);

    if (newStatus === 'won') await this.updateBalance(row.user_phone, parlay.potentialWin);

    const newBalance = newStatus !== 'pending' ? await this.getBalance(row.user_phone) : null;

    return {
      parlay: { ...parlay, legs, status: newStatus },
      settled: newStatus !== 'pending',
      won: newStatus === 'won',
      newBalance
    };
  }

  _mapParlay(p) {
    return {
      id: p.id,
      userPhone: p.user_phone,
      legs: p.legs || [],
      combinedOdds: parseFloat(p.combined_odds),
      amount: parseFloat(p.amount),
      potentialWin: parseFloat(p.potential_win),
      status: p.status,
      createdAt: p.created_at,
      settledAt: p.settled_at,
      cancelledAt: p.cancelled_at
    };
  }

  // --- Admin methods ---

  async getAllUsers() {
    const [{ data: users }, { data: allBets }] = await Promise.all([
      db().from('users').select('*').order('registered_at', { ascending: false }),
      db().from('bets').select('*').order('created_at', { ascending: false })
    ]);

    const betsByPhone = {};
    (allBets || []).forEach(b => {
      if (!betsByPhone[b.user_phone]) betsByPhone[b.user_phone] = [];
      betsByPhone[b.user_phone].push(this._mapBet(b));
    });

    return (users || []).map(u => ({
      clientId: u.client_id,
      phone: u.phone,
      name: u.name,
      email: u.email,
      balance: u.balance,
      registeredAt: u.registered_at,
      bets: betsByPhone[u.phone] || []
    }));
  }

  async addUser(userData) {
    const { data, error } = await db().from('users').insert({
      client_id: userData.clientId,
      phone: normalizePhone(userData.phone),
      name: userData.name,
      email: userData.email || '',
      balance: parseInt(userData.balance) || 5000,
      registered_at: new Date().toISOString()
    }).select().single();

    if (error) throw new Error(error.message);
    return { ...data, clientId: data.client_id };
  }

  async deleteUser(phone) {
    const { error } = await db().from('users').delete().eq('phone', normalizePhone(phone));
    return !error;
  }

  async getAllBets(filter = {}) {
    let query = db()
      .from('bets')
      .select('*, users(name)')
      .order('created_at', { ascending: false });

    if (filter.phone) query = query.eq('user_phone', normalizePhone(filter.phone));
    if (filter.status) query = query.eq('status', filter.status);

    const { data } = await query;
    return (data || []).map(b => ({
      ...this._mapBet(b),
      userPhone: b.user_phone,
      userName: b.users?.name
    }));
  }

  _mapBet(b) {
    return {
      id: b.id,
      gameId: b.game_id,
      game: b.game,
      team: b.team,
      odds: b.odds,
      amount: b.amount,
      potentialWin: b.potential_win,
      status: b.status,
      createdAt: b.created_at,
      result: b.result,
      settledAt: b.settled_at,
      cancelledAt: b.cancelled_at
    };
  }
}

module.exports = new StrendusAPIService();
