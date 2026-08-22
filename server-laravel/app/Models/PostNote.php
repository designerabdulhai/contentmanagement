<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class PostNote extends Model
{
    use HasFactory;
    protected $fillable = ['post_id','user_id','message','mentioned_user_ids'];

    protected $casts = ['mentioned_user_ids' => 'array'];

    public function user(){ return $this->belongsTo(User::class,'user_id'); }
    public function post(){ return $this->belongsTo(ScheduledPost::class,'post_id'); }
}
