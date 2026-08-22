<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class ActivityLog extends Model
{
    use HasFactory;
    public $timestamps = false;
    protected $table = 'activity_log';
    protected $fillable = ['post_id','user_id','action','details','created_at'];
}
