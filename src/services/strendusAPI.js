const fs = require('fs');
const path = require('path');

const USERS_FILE = path.join(__dirname, '../data/users.json');

class StrendusAPIService {
  constructor() {
    this.loadUsers();
  }

  /**
   * Cargar usuarios desde el archivo JSON
   */
  loadUsers() {
    try {
      const data = fs.readFileSync(USERS_FILE, 'utf8');
      this.usersData = JSON.parse(data);
    } catch (error) {
      console.error('Error cargando usuarios:', error.message);
      this.usersData = { users: [] };
    }
  }

  /**
   * Guardar usuarios al archivo JSON
   */
  saveUsers() {
    try {
      fs.writeFileSync(USERS_FILE, JSON.stringify(this.usersData, null, 2));
    } catch (error) {
      console.error('Error guardando usuarios:', error.message);
    }
  }

  normalizePhone(phone) {
    return String(phone || '').replace(/^\+/, '');
  }

  /**
   * Verificar usuario por número de teléfono
   */
  verifyUser(phone) {
    const normalized = this.normalizePhone(phone);
    const user = this.usersData.users.find(u => this.normalizePhone(u.phone) === normalized);
    
    if (!user) {
      return {
        exists: false,
        message: 'Usuario no encontrado'
      };
    }

    return {
      exists: true,
      user: {
        clientId: user.clientId,
        name: user.name,
        balance: user.balance,
        email: user.email
      }
    };
  }

  /**
   * Verificar usuario por número de cliente
   */
  verifyByClientId(clientId, phone) {
    const input = clientId.trim().toLowerCase();
    const user = this.usersData.users.find(
      u => u.clientId === clientId.trim() || u.email.toLowerCase() === input
    );

    if (!user) {
      return {
        success: false,
        message: 'Número de cliente o correo no encontrado'
      };
    }

    if (this.normalizePhone(user.phone) !== this.normalizePhone(phone)) {
      return {
        success: false,
        message: `El número de cliente ${clientId} está registrado con otro número de teléfono.`,
        registeredPhone: user.phone.slice(-4)
      };
    }

    return {
      success: true,
      user: {
        clientId: user.clientId,
        name: user.name,
        balance: user.balance,
        email: user.email
      }
    };
  }

  /**
   * Obtener saldo del usuario
   */
  getBalance(phone) {
    const user = this.usersData.users.find(u => this.normalizePhone(u.phone) === this.normalizePhone(phone));
    return user ? user.balance : 0;
  }

  /**
   * Actualizar saldo del usuario
   */
  updateBalance(phone, amount) {
    const userIndex = this.usersData.users.findIndex(u => this.normalizePhone(u.phone) === this.normalizePhone(phone));
    
    if (userIndex === -1) return false;

    this.usersData.users[userIndex].balance += amount;
    this.saveUsers();
    
    return this.usersData.users[userIndex].balance;
  }

  /**
   * Crear una apuesta
   */
  createBet(phone, betData) {
    const userIndex = this.usersData.users.findIndex(u => this.normalizePhone(u.phone) === this.normalizePhone(phone));
    
    if (userIndex === -1) {
      return { success: false, message: 'Usuario no encontrado' };
    }

    const user = this.usersData.users[userIndex];

    // Verificar saldo suficiente
    if (user.balance < betData.amount) {
      return { 
        success: false, 
        message: 'Saldo insuficiente',
        currentBalance: user.balance 
      };
    }

    // Crear apuesta
    const bet = {
      id: `BET-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      gameId: betData.gameId,
      game: betData.game,
      team: betData.team,
      odds: betData.odds,
      amount: betData.amount,
      potentialWin: betData.potentialWin,
      status: 'pending', // pending, won, lost, cancelled
      createdAt: new Date().toISOString(),
      result: null
    };

    // Descontar saldo
    this.usersData.users[userIndex].balance -= betData.amount;
    
    // Agregar apuesta
    if (!this.usersData.users[userIndex].bets) {
      this.usersData.users[userIndex].bets = [];
    }
    this.usersData.users[userIndex].bets.unshift(bet);

    // Mantener solo las últimas 50 apuestas
    if (this.usersData.users[userIndex].bets.length > 50) {
      this.usersData.users[userIndex].bets = this.usersData.users[userIndex].bets.slice(0, 50);
    }

    this.saveUsers();

    return {
      success: true,
      bet: bet,
      newBalance: this.usersData.users[userIndex].balance
    };
  }

  /**
   * Obtener historial de apuestas
   */
  getBetHistory(phone, limit = 15) {
    const user = this.usersData.users.find(u => this.normalizePhone(u.phone) === this.normalizePhone(phone));
    
    if (!user || !user.bets) {
      return [];
    }

    return user.bets.slice(0, limit);
  }

  /**
   * Obtener una apuesta específica
   */
  getBet(phone, betId) {
    const user = this.usersData.users.find(u => this.normalizePhone(u.phone) === this.normalizePhone(phone));
    
    if (!user || !user.bets) {
      return null;
    }

    return user.bets.find(b => b.id === betId);
  }

  /**
   * Cancelar una apuesta
   */
  cancelBet(phone, betId) {
    const userIndex = this.usersData.users.findIndex(u => this.normalizePhone(u.phone) === this.normalizePhone(phone));
    
    if (userIndex === -1) {
      return { success: false, message: 'Usuario no encontrado' };
    }

    const user = this.usersData.users[userIndex];
    const betIndex = user.bets?.findIndex(b => b.id === betId);

    if (betIndex === -1 || betIndex === undefined) {
      return { success: false, message: 'Apuesta no encontrada' };
    }

    const bet = user.bets[betIndex];

    if (bet.status !== 'pending') {
      return { success: false, message: 'Solo se pueden cancelar apuestas pendientes' };
    }

    // Devolver saldo
    this.usersData.users[userIndex].balance += bet.amount;
    
    // Marcar como cancelada
    this.usersData.users[userIndex].bets[betIndex].status = 'cancelled';
    this.usersData.users[userIndex].bets[betIndex].cancelledAt = new Date().toISOString();

    this.saveUsers();

    return {
      success: true,
      refundedAmount: bet.amount,
      newBalance: this.usersData.users[userIndex].balance
    };
  }

  /**
   * Actualizar resultado de una apuesta
   */
  updateBetResult(phone, betId, won, result) {
    const userIndex = this.usersData.users.findIndex(u => this.normalizePhone(u.phone) === this.normalizePhone(phone));
    
    if (userIndex === -1) return false;

    const betIndex = this.usersData.users[userIndex].bets?.findIndex(b => b.id === betId);
    
    if (betIndex === -1 || betIndex === undefined) return false;

    const bet = this.usersData.users[userIndex].bets[betIndex];

    // Actualizar estado
    this.usersData.users[userIndex].bets[betIndex].status = won ? 'won' : 'lost';
    this.usersData.users[userIndex].bets[betIndex].result = result;
    this.usersData.users[userIndex].bets[betIndex].settledAt = new Date().toISOString();

    // Si ganó, agregar ganancia
    if (won) {
      this.usersData.users[userIndex].balance += bet.potentialWin;
    }

    this.saveUsers();

    return {
      success: true,
      won: won,
      amount: won ? bet.potentialWin : bet.amount,
      newBalance: this.usersData.users[userIndex].balance
    };
  }

  /**
   * Obtener apuestas pendientes del usuario
   */
  getPendingBets(phone) {
    const user = this.usersData.users.find(u => this.normalizePhone(u.phone) === this.normalizePhone(phone));
    
    if (!user || !user.bets) {
      return [];
    }

    return user.bets.filter(b => b.status === 'pending');
  }

  /**
   * Obtener todas las apuestas pendientes de todos los usuarios (para procesar resultados)
   */
  getAllPendingBets() {
    const allPendingBets = [];

    this.usersData.users.forEach(user => {
      if (user.bets) {
        const userPendingBets = user.bets
          .filter(b => b.status === 'pending')
          .map(b => ({
            ...b,
            userPhone: user.phone,
            userName: user.name
          }));
        
        allPendingBets.push(...userPendingBets);
      }
    });

    return allPendingBets;
  }

  /**
   * Obtener información completa del usuario
   */
  getUserInfo(phone) {
    const user = this.usersData.users.find(u => this.normalizePhone(u.phone) === this.normalizePhone(phone));
    
    if (!user) return null;

    return {
      clientId: user.clientId,
      name: user.name,
      email: user.email,
      balance: user.balance,
      totalBets: user.bets?.length || 0,
      pendingBets: user.bets?.filter(b => b.status === 'pending').length || 0,
      wonBets: user.bets?.filter(b => b.status === 'won').length || 0,
      lostBets: user.bets?.filter(b => b.status === 'lost').length || 0
    };
  }
}

module.exports = new StrendusAPIService();
