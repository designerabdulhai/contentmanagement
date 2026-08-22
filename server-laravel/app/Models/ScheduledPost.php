<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class ScheduledPost extends Model
{
    use HasFactory;
    protected $table = 'scheduled_posts';
    protected $fillable = ['project_id','project_name','content_type','channel','platform','status','scheduled_at','uploaded_link','is_overdue','created_by'];

    public function creator(){ return $this->belongsTo(User::class,'created_by'); }
    public function notes(){ return $this->hasMany(PostNote::class,'post_id'); }
}
